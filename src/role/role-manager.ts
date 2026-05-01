/**
 * RoleManager — 加载角色配置并监视变更。
 *
 * 角色文件在加载时针对 RoleConfigSchema 进行 JSON 验证。
 * 通过 `fs.watch` 支持热重载。
 */

import fs from 'node:fs';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { createScopedLogger } from '../core/logger';
import { AppError } from '../core/errors';
import type { RoleConfig, Unsubscribe } from '../core/types';
import { RoleConfigSchema } from './role-schema';

const logger = createScopedLogger('role');

export class RoleManager {
  private roles: Map<string, RoleConfig> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;
  private rolesDir: string | null = null;
  private roleSources: Map<string, string> = new Map();
  private changeListeners: Array<() => void> = [];

  // ─── 生命周期 ────────────────────────────────────────────────

  /**
   * 从给定目录加载所有角色 JSON 文件。
   *
   * 每个文件都会被解析并针对 `RoleConfigSchema` 进行验证。
   * 格式错误的文件将被跳过并发出警告。
   */
  async loadAll(rolesDir: string): Promise<void> {
    this.rolesDir = rolesDir;

    await mkdir(rolesDir, { recursive: true });

    let entries: Dirent[];
    try {
      entries = await readdir(rolesDir, { withFileTypes: true });
    } catch (err) {
      logger.error(`读取角色目录失败: ${rolesDir}`, err);
      throw err;
    }

    const loadedRoles = new Map<string, RoleConfig>();
    const loadedSources = new Map<string, string>();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(rolesDir, entry.name);
      try {
        const role = await this.parseRoleFile(filePath);
        if (role) {
          const existingSource = loadedSources.get(role.id);
          if (existingSource) {
            throw new AppError(
              `角色 id "${role.id}" 在 ${existingSource} 和 ${filePath} 中重复`,
              'CONFIG_VALIDATION',
            );
          }
          loadedRoles.set(role.id, role);
          loadedSources.set(role.id, filePath);
        }
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        logger.warn(`跳过无效的角色文件: ${filePath}`, err);
      }
    }

    this.roles = loadedRoles;
    this.roleSources = loadedSources;

    logger.info(`已加载 ${this.roles.size} 个角色`);
    this.notifyChanges();
  }

  subscribeChanges(listener: () => void): Unsubscribe {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((candidate) => candidate !== listener);
    };
  }

  /** 开始监视角色目录的变更。 */
  startWatching(): void {
    if (!this.rolesDir) {
      throw new AppError('角色未加载 — 无法开始监视', 'CONFIG_VALIDATION');
    }

    if (this.watcher) {
      return; // 已在监视中
    }

    this.watcher = fs.watch(this.rolesDir, () => {
      this.handleFileChange();
    });

    this.watcher.on('error', (err: Error) => {
      logger.error('角色目录监视器错误', err);
    });

    logger.info('角色热重载监视器已启动');
  }

  /** 停止监视角色目录。 */
  stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('角色热重载监视器已停止');
    }
  }

  // ─── 读取 ──────────────────────────────────────────────────────

  /** 通过 ID 获取角色。如果未找到，则回退到 `getDefaultRole()`。 */
  getRole(roleId: string): RoleConfig {
    const role = this.roles.get(roleId);
    if (role) return role;
    logger.warn(`未找到角色 "${roleId}" — 回退到默认角色`);
    return this.getDefaultRole();
  }

  /** 获取默认角色: id 为 'default' 的角色，或第一个启用的角色。 */
  getDefaultRole(): RoleConfig {
    const defaultRole = this.roles.get('default');
    if (defaultRole) return defaultRole;

    const firstEnabled = this.getEnabledRoles()[0];
    if (firstEnabled !== undefined) return firstEnabled;

    throw new AppError(
      '没有可用角色 — 必须至少定义一个角色',
      'CONFIG_VALIDATION',
    );
  }

  /** 获取所有已启用的角色。 */
  getEnabledRoles(): RoleConfig[] {
    return [...this.roles.values()].filter((r) => r.enabled);
  }

  /** 获取所有角色（包括已禁用的）。 */
  getAllRoles(): RoleConfig[] {
    return [...this.roles.values()];
  }

  /**
   * 将角色保存回其源文件并更新内存缓存。
   *
   * @throws 如果找不到角色文件或数据验证失败。
   */
  async saveRole(roleId: string, roleData: RoleConfig): Promise<void> {
    if (!this.rolesDir) {
      throw new AppError('角色未加载', 'CONFIG_VALIDATION');
    }

    const validated = Value.Default(RoleConfigSchema, roleData);
    if (!Value.Check(RoleConfigSchema, validated)) {
      const errors = [...Value.Errors(RoleConfigSchema, validated)];
      throw new AppError('角色验证失败', 'CONFIG_VALIDATION', errors);
    }

    const targetFile = this.roleSources.get(roleId) ?? null;

    if (!targetFile) {
      throw new AppError(`未找到角色 "${roleId}" 的文件`, 'CONFIG_VALIDATION');
    }

    await writeFile(targetFile, JSON.stringify(roleData, null, 2), 'utf-8');

    // 更新内存缓存
    this.roles.set(roleId, roleData);
    this.roleSources.set(roleId, targetFile);
    this.notifyChanges();
    logger.info('角色已保存', { roleId, file: targetFile });
  }

  /**
   * 创建一个新角色并将其持久化到角色目录。
   *
   * @param roleData 角色配置（如果 id 为空，将自动生成）。
   * @returns 创建的角色 RoleConfig。
   * @throws 如果角色目录不可用或验证失败。
   */
  async createRole(roleData: Omit<RoleConfig, 'id'> & { id?: string }): Promise<RoleConfig> {
    if (!this.rolesDir) {
      throw new AppError('角色未加载', 'CONFIG_VALIDATION');
    }

    const id = roleData.id || randomUUID();
    const fullRole: RoleConfig = { ...roleData, id };

    const validated = Value.Default(RoleConfigSchema, fullRole);
    if (!Value.Check(RoleConfigSchema, validated)) {
      const errors = [...Value.Errors(RoleConfigSchema, validated)];
      throw new AppError('角色验证失败', 'CONFIG_VALIDATION', errors);
    }

    const filename = `${id}.json`;
    const filePath = path.join(this.rolesDir, filename);
    await writeFile(filePath, JSON.stringify(validated, null, 2), 'utf-8');

    this.roles.set(id, validated);
    this.roleSources.set(id, filePath);
    this.notifyChanges();
    logger.info('角色已创建', { roleId: id, file: filePath });

    return validated;
  }

  /**
   * 删除角色及其源文件。
   *
   * @param roleId 要删除的角色 ID。
   * @throws 角色目录未加载、角色不存在，或尝试删除 'default' 角色时抛出。
   */
  async deleteRole(roleId: string): Promise<void> {
    if (!this.rolesDir) {
      throw new AppError('角色未加载', 'CONFIG_VALIDATION');
    }

    if (roleId === 'default') {
      throw new AppError('默认角色不可删除', 'CONFIG_VALIDATION');
    }

    const targetFile = this.roleSources.get(roleId);
    if (!targetFile) {
      throw new AppError(`未找到角色 "${roleId}"`, 'CONFIG_VALIDATION');
    }

    await rm(targetFile, { force: true });

    this.roles.delete(roleId);
    this.roleSources.delete(roleId);
    this.notifyChanges();
    logger.info('角色已删除', { roleId, file: targetFile });
  }

  // ─── 私有辅助方法 ───────────────────────────────────────────

  /**
   * 解析并验证角色 JSON 文件。
   *
   * @returns 验证后的 `RoleConfig`，如果文件无效则返回 `null`。
   */
  private async parseRoleFile(filePath: string): Promise<RoleConfig | null> {
    const raw = await readFile(filePath, 'utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn(`角色文件中的 JSON 无效: ${filePath}`, err);
      return null;
    }

    const role = Value.Default(RoleConfigSchema, parsed);

    if (!Value.Check(RoleConfigSchema, role)) {
      const errors = [...Value.Errors(RoleConfigSchema, role)];
      logger.warn(`角色验证失败 ${filePath}: ${JSON.stringify(errors)}`);
      return null;
    }

    const roleConfig = role as RoleConfig;
    return roleConfig.id === 'default' ? { ...roleConfig, enabled: true } : roleConfig;
  }

  /**
   * 通过重新加载所有角色来处理文件变更事件。
   */
  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      void (async () => {
        this.debounceTimer = null;
        if (this.rolesDir) {
          try {
            await this.loadAll(this.rolesDir);
            logger.info('文件变更后角色已重新加载');
          } catch (err) {
            logger.error('文件变更后重新加载角色失败', err);
          }
        }
      })();
    }, this.DEBOUNCE_MS);
  }

  private notifyChanges(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (err) {
        logger.error('角色变更监听器失败', err);
      }
    }
  }
}
