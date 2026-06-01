/**
 * RoleManager — 角色配置管理器。
 *
 * 负责：
 * - 从文件加载角色配置
 * - 角色 CRUD 操作
 * - 热重载监听
 * - 默认角色回退逻辑
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import Conf from 'conf';
import type { RoleConfig } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { validateWithSchema } from '@aesyclaw/core/config/schema-utils';
import { RolesConfigSchema } from './role-schema';
import { DEFAULT_ROLES_CONFIG } from './default-role';

const logger = createScopedLogger('role');

export class RoleManager {
  private readonly ROLES_STORE_KEY = 'roles';
  private rolesStore: Conf<Record<string, unknown>>;
  private lastKnownRoles: readonly RoleConfig[];
  private unsubscribeHotReload?: () => void;
  private readonly rolesPath: string;

  constructor(rolesPath: string) {
    this.rolesPath = rolesPath;
    this.ensureDir();
    const loaded = this.loadRoles();
    this.rolesStore = loaded.store;
    this.lastKnownRoles = loaded.roles;
  }

  async initialize(): Promise<void> {
    logger.info(`已加载 ${this.getAllRoles().length} 个角色`);
  }

  destroy(): void {
    this.stopHotReload();
  }

  // ─── 查询方法 ──────────────────────────────────────────────────

  getRole(roleId: string): RoleConfig {
    const role = this.getAllRoles().find((candidate) => candidate.id === roleId);
    if (role) return role;
    throw new Error(`未找到角色 "${roleId}"`);
  }

  getDefaultRole(): RoleConfig {
    const roles = this.getAllRoles();
    const defaultRole = roles.find((role) => role.id === 'default');
    if (defaultRole) return defaultRole;

    const firstEnabled = roles.find((role) => role.enabled);
    if (firstEnabled !== undefined) return firstEnabled;

    throw new Error('没有可用角色 — 必须至少定义一个角色');
  }

  getEnabledRoles(): RoleConfig[] {
    return this.getAllRoles().filter((role) => role.enabled);
  }

  getAllRoles(): RoleConfig[] {
    return structuredClone(this.lastKnownRoles) as RoleConfig[];
  }

  // ─── 修改方法 ──────────────────────────────────────────────────

  async saveRole(roleId: string, roleData: RoleConfig): Promise<void> {
    const roles = this.getAllRoles();
    const existing = roles.find((role) => role.id === roleId);
    if (!existing) {
      throw new Error(`未找到角色 "${roleId}"`);
    }

    const updatedRoles = roles.map((role) => (role.id === roleId ? roleData : role));
    await this.setRoles(updatedRoles);
    logger.info('角色已保存', { roleId });
  }

  async createRole(roleData: Omit<RoleConfig, 'id'> & { id?: string }): Promise<RoleConfig> {
    const id = roleData.id ?? randomUUID();
    const roles = this.getAllRoles();
    if (roles.some((role) => role.id === id)) {
      throw new Error(`角色 "${id}" 已存在`);
    }

    const fullRole: RoleConfig = { ...roleData, id };
    await this.setRoles([...roles, fullRole]);
    logger.info('角色已创建', { roleId: id });

    return fullRole;
  }

  async deleteRole(roleId: string): Promise<void> {
    if (roleId === 'default') {
      throw new Error('默认角色不可删除');
    }

    const roles = this.getAllRoles();
    if (!roles.some((role) => role.id === roleId)) {
      throw new Error(`未找到角色 "${roleId}"`);
    }

    await this.setRoles(roles.filter((role) => role.id !== roleId));
    logger.info('角色已删除', { roleId });
  }

  // ─── 热重载 ────────────────────────────────────────────────────

  startHotReload(): void {
    this.stopHotReload();
    this.unsubscribeHotReload = this.rolesStore.onDidAnyChange(() => {
      void this.reloadRolesFromFile();
    });
    logger.info('角色热重载监视器已启动');
  }

  stopHotReload(): void {
    this.unsubscribeHotReload?.();
    this.unsubscribeHotReload = undefined;
  }

  // ─── 私有方法 ──────────────────────────────────────────────────

  private ensureDir(): void {
    mkdirSync(dirname(this.rolesPath), { recursive: true });
  }

  private loadRoles(): {
    store: Conf<Record<string, unknown>>;
    roles: readonly RoleConfig[];
  } {
    if (!existsSync(this.rolesPath)) {
      logger.info('未找到角色配置文件，正在使用默认值创建', { path: this.rolesPath });
      const store = this.createStore(this.rolesPath);
      this.writeRolesToStore(store, DEFAULT_ROLES_CONFIG);
      return { store, roles: structuredClone(DEFAULT_ROLES_CONFIG) };
    }

    logger.info('正在加载角色配置', { path: this.rolesPath });
    const store = this.createStore(this.rolesPath);
    const roles = this.readValidatedRolesFromStore(store);
    return { store, roles };
  }

  private readValidatedRolesFromStore(store: Conf<Record<string, unknown>>): RoleConfig[] {
    const raw = store.store[this.ROLES_STORE_KEY];
    const validated = validateWithSchema<RoleConfig[]>(RolesConfigSchema, raw, '角色配置');
    const roles = this.normaliseRoles(validated);
    this.assertUniqueRoleIds(roles);
    return roles;
  }

  private writeRolesToStore(
    store: Conf<Record<string, unknown>>,
    roles: readonly RoleConfig[],
  ): void {
    store.store = {
      [this.ROLES_STORE_KEY]: structuredClone(roles),
    } as Record<string, unknown>;
  }

  private async setRoles(roles: readonly RoleConfig[]): Promise<void> {
    const validated = validateWithSchema<RoleConfig[]>(RolesConfigSchema, roles, '角色配置');
    const normalised = this.normaliseRoles(validated);
    this.assertUniqueRoleIds(normalised);
    this.writeRolesToStore(this.rolesStore, normalised);
    this.lastKnownRoles = structuredClone(normalised);
  }

  private async reloadRolesFromFile(): Promise<void> {
    try {
      const newRoles = this.readValidatedRolesFromStore(this.rolesStore);
      if (JSON.stringify(this.lastKnownRoles) === JSON.stringify(newRoles)) {
        logger.debug('角色配置文件已变更但内容相同 —— 跳过');
        return;
      }
      this.lastKnownRoles = structuredClone(newRoles);
      logger.info('已从文件重新加载角色配置缓存');
    } catch (err) {
      logger.error('重新加载角色配置文件失败，继续使用上一次有效角色配置', err);
    }
  }

  private assertUniqueRoleIds(roles: readonly RoleConfig[]): void {
    const seen = new Set<string>();
    for (const role of roles) {
      if (seen.has(role.id)) {
        throw new Error(`角色 id "${role.id}" 重复`);
      }
      seen.add(role.id);
    }
  }

  private normaliseRoles(roles: readonly RoleConfig[]): RoleConfig[] {
    return roles.map((role) => (role.id === 'default' ? { ...role, enabled: true } : role));
  }

  private createStore(filePath: string): Conf<Record<string, unknown>> {
    const extension = extname(filePath);
    const fileExtension = extension.startsWith('.') ? extension.slice(1) : extension;

    try {
      return new Conf<Record<string, unknown>>({
        cwd: dirname(filePath),
        configName: extension ? basename(filePath, extension) : basename(filePath),
        fileExtension,
        clearInvalidConfig: false,
        serialize: (value) => JSON.stringify(value[this.ROLES_STORE_KEY] ?? [], null, 2),
        deserialize: (value) => ({ [this.ROLES_STORE_KEY]: JSON.parse(value) }),
        watch: true,
      });
    } catch (err) {
      throw new Error('角色配置文件中的 JSON 无效', { cause: err });
    }
  }
}
