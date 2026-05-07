/**
 * ConfigManager — 加载、验证、缓存、热重载配置。
 *
 * 关键行为：
 * - 从 JSON 文件加载配置；缺失时创建默认配置
 * - TypeBox 验证，缺失字段回退到默认值
 * - `get(path)` 从最新合法缓存读取配置路径
 * - `set(path, value)` 替换配置路径并持久化
 * - `patch(path, value)` 深合并对象路径并持久化
 * - 热重载只刷新内部缓存，不分发订阅通知
 * - `registerDefaults` / `syncDefaults` 供子系统声明默认值
 */

import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import Conf from 'conf';
import type { RoleConfig } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { isRecord, mergeDefaults } from '@aesyclaw/core/utils';
import { DEFAULT_ROLES_CONFIG } from '@aesyclaw/role/default-role';
import { RolesConfigSchema } from '@aesyclaw/role/role-schema';
import { AppConfigSchema } from './schema';
import type { AppConfig } from './schema';
import { DEFAULT_CONFIG } from './defaults';

const logger = createScopedLogger('config-manager');

export type ConfigManagerDependencies = {
  configPath: string;
  rolesPath: string;
};

export class ConfigManager {
  private readonly ROLES_STORE_KEY = 'roles';
  private configPath: string | null = null;
  private rolesPath: string | null = null;
  private lastKnownConfig: AppConfig | null = null;
  private lastKnownRoles: readonly RoleConfig[] | null = null;
  private registeredDefaults = new Map<string, Record<string, unknown>>();
  private configStore: Conf<Record<string, unknown>> | null = null;
  private rolesStore: Conf<Record<string, unknown>> | null = null;
  private selfUpdating = false;
  private rolesSelfUpdating = false;
  private reloadAfterGuard = false;
  private reloadRolesAfterGuard = false;
  private readonly DEBOUNCE_MS = 300;
  private unsubscribeHotReload?: () => void;
  private unsubscribeRolesHotReload?: () => void;

  // ─── 生命周期 ────────────────────────────────────────────────

  /**
   * 标准管理器生命周期入口 —— 委托给 {@link load}。
   */
  async initialize(deps: ConfigManagerDependencies): Promise<void> {
    await this.load(deps.configPath);
    await this.loadRoles(deps.rolesPath);
  }

  /**
   * 从给定路径加载配置。
   * 如果文件不存在，则使用默认值创建。
   */
  private async load(configPath: string): Promise<void> {
    if (this.configStore) {
      logger.warn('配置已加载 — 跳过');
      return;
    }
    this.configPath = configPath;
    mkdirSync(dirname(configPath), { recursive: true });

    if (!existsSync(configPath)) {
      logger.info('未找到配置文件，正在使用默认值创建', { path: configPath });
      this.configStore = this.createConfigStore(configPath);
      this.writeConfigToStore(DEFAULT_CONFIG);
      this.lastKnownConfig = structuredClone(DEFAULT_CONFIG);
    } else {
      logger.info('正在加载配置', { path: configPath });
      this.configStore = this.createConfigStore(configPath);
      this.lastKnownConfig = this.readValidatedConfigFromStore();
    }
  }

  /** 从给定路径加载 roles.json；缺失时创建默认角色数组。 */
  private async loadRoles(rolesPath: string): Promise<void> {
    if (this.rolesStore) {
      logger.warn('角色配置已加载 — 跳过');
      return;
    }

    this.rolesPath = rolesPath;
    mkdirSync(dirname(rolesPath), { recursive: true });

    const exists = existsSync(rolesPath);
    if (!exists) {
      logger.info('未找到角色配置文件，正在使用默认值创建', { path: rolesPath });
      this.rolesStore = this.createRolesStore(rolesPath);
      this.writeRolesToStore(DEFAULT_ROLES_CONFIG);
      this.lastKnownRoles = structuredClone(DEFAULT_ROLES_CONFIG);
      return;
    }

    logger.info('正在加载角色配置', { path: rolesPath });
    this.rolesStore = this.createRolesStore(rolesPath);
    this.lastKnownRoles = this.readValidatedRolesFromStore();
  }

  // ─── 读取 ──────────────────────────────────────────────────────

  /** 获取配置路径的只读快照；路径不存在时返回 undefined。 */
  get(path: string): unknown {
    const config = this.requireConfigCache();
    const value = getPathValue(config as Record<string, unknown>, path);
    return value === undefined ? undefined : structuredClone(value);
  }

  /** 获取角色配置快照。 */
  getRoles(): readonly RoleConfig[] {
    return structuredClone(this.requireRolesCache());
  }

  // ─── 写入 ─────────────────────────────────────────────────────

  /** 替换配置路径并持久化。 */
  async set(path: string, value: unknown): Promise<void> {
    this.ensureLoaded();
    const oldConfig = this.requireConfigCache();
    const nextConfig = structuredClone(oldConfig) as Record<string, unknown>;
    setPathValue(nextConfig, path, value);
    const validatedConfig = this.validateWithSchema<AppConfig>(AppConfigSchema, nextConfig, '配置');
    this.persistWithGuard(validatedConfig);
  }

  /** 深合并对象配置路径并持久化。 */
  async patch(path: string, value: Record<string, unknown>): Promise<void> {
    this.ensureLoaded();
    if (!isRecord(value)) {
      throw new Error('patch 值必须是对象');
    }

    const oldConfig = this.requireConfigCache();
    const nextConfig = structuredClone(oldConfig) as Record<string, unknown>;
    const current = getPathValue(nextConfig, path);
    if (current !== undefined && !isRecord(current)) {
      throw new Error(`配置路径 "${path}" 不是对象，不能 patch`);
    }

    const merged = mergeDefaults((current ?? {}) as Record<string, unknown>, value);
    setPathValue(nextConfig, path, merged);
    const validatedConfig = this.validateWithSchema<AppConfig>(AppConfigSchema, nextConfig, '配置');
    this.persistWithGuard(validatedConfig);
  }

  /** 替换并持久化完整角色数组。 */
  async setRoles(roles: readonly RoleConfig[]): Promise<void> {
    this.ensureRolesLoaded();
    const oldRoles = this.requireRolesCache();
    const validated = this.validateWithSchema<RoleConfig[]>(RolesConfigSchema, roles, '角色配置');
    const newRoles = normaliseRoles(validated);
    this.assertUniqueRoleIds(newRoles);

    if (JSON.stringify(oldRoles) === JSON.stringify(newRoles)) {
      return;
    }

    this.persistRolesWithGuard(newRoles);
  }

  // ─── 默认值 ──────────────────────────────────────────────────

  /**
   * 为子系统注册默认值。
   * 这些值通过 `syncDefaults()` 同步到配置中。
   *
   * 支持点号 key(如 `'channels.testchannel'`),会被展开为
   * `{ channels: { testchannel: defaults } }` 嵌套结构后参与合并。
   */
  registerDefaults(key: string, defaults: Record<string, unknown>): void {
    this.registeredDefaults.set(key, defaults);
  }

  /**
   * 将所有已注册的默认值合并到当前配置并持久化。
   * 通常在启动结束时调用,此时所有子系统都已注册其默认值。
   */
  async syncDefaults(): Promise<void> {
    this.ensureLoaded();

    let mergedConfig = structuredClone(this.requireConfigCache());
    for (const [key, defaults] of this.registeredDefaults) {
      const nestedPartial = buildNestedObject(key, defaults);
      mergedConfig = mergeDefaults(mergedConfig as Record<string, unknown>, nestedPartial, {
        overwrite: false,
      }) as AppConfig;
    }
    const validatedConfig = this.validateWithSchema<AppConfig>(
      AppConfigSchema,
      mergedConfig,
      '配置',
    );

    this.persistWithGuard(validatedConfig);
  }

  // ─── 热重载 ─────────────────────────────────────────────────

  /** 开始监视配置文件的外部变更 */
  startHotReload(): void {
    if (!this.configPath || !this.configStore || !this.rolesPath || !this.rolesStore) {
      throw new Error('配置未加载 —— 无法启动热重载');
    }

    this.stopHotReload();

    this.unsubscribeHotReload = this.configStore.onDidAnyChange(() => {
      void this.reloadFromFile();
    });

    this.unsubscribeRolesHotReload = this.rolesStore.onDidAnyChange(() => {
      void this.reloadRolesFromFile();
    });

    logger.info('热重载监视器已启动');
  }

  /** 停止监视配置文件 */
  stopHotReload(): void {
    if (this.unsubscribeHotReload) {
      this.unsubscribeHotReload();
      this.unsubscribeHotReload = undefined;
    }
    if (this.unsubscribeRolesHotReload) {
      this.unsubscribeRolesHotReload();
      this.unsubscribeRolesHotReload = undefined;
    }
    logger.info('热重载监视器已停止');
  }

  // ─── 私有辅助函数 ───────────────────────────────────────────

  private async reloadFromFile(): Promise<void> {
    if (!this.configStore) return;
    if (this.selfUpdating) {
      this.reloadAfterGuard = true;
      return;
    }

    try {
      const oldConfig = this.lastKnownConfig;
      const newConfig = this.readValidatedConfigFromStore();
      if (oldConfig && JSON.stringify(oldConfig) === JSON.stringify(newConfig)) {
        logger.debug('配置文件已变更但内容相同 —— 跳过');
        return;
      }
      this.lastKnownConfig = structuredClone(newConfig);
      logger.info('已从文件重新加载配置缓存');
    } catch (err) {
      logger.error('重新加载配置文件失败，继续使用上一次有效配置', err);
    }
  }

  private async reloadRolesFromFile(): Promise<void> {
    if (!this.rolesStore) return;
    if (this.rolesSelfUpdating) {
      this.reloadRolesAfterGuard = true;
      return;
    }

    try {
      const oldRoles = this.lastKnownRoles;
      const newRoles = this.readValidatedRolesFromStore();
      if (oldRoles && JSON.stringify(oldRoles) === JSON.stringify(newRoles)) {
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

  private findMissingFields(
    parsed: Record<string, unknown>,
    validated: Record<string, unknown>,
    prefix = '',
  ): string[] {
    const missing: string[] = [];

    for (const key of Object.keys(validated)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!(key in parsed)) {
        missing.push(path);
      } else if (
        validated[key] !== null &&
        typeof validated[key] === 'object' &&
        !Array.isArray(validated[key]) &&
        parsed[key] !== null &&
        typeof parsed[key] === 'object' &&
        !Array.isArray(parsed[key])
      ) {
        missing.push(
          ...this.findMissingFields(
            parsed[key] as Record<string, unknown>,
            validated[key] as Record<string, unknown>,
            path,
          ),
        );
      }
    }

    return missing;
  }

  private validateWithSchema<T>(
    schema: Parameters<typeof Value.Check>[0],
    value: unknown,
    label: string,
  ): T {
    const validated = Value.Default(schema, value);
    if (!Value.Check(schema, validated)) {
      const errors = [...Value.Errors(schema, validated)]
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ');
      throw new Error(`${label}验证失败: ${errors}`);
    }
    return validated as T;
  }

  private ensureLoaded(): Conf<Record<string, unknown>> {
    if (!this.configPath || !this.configStore) {
      throw new Error('配置未加载');
    }
    return this.configStore;
  }

  private ensureRolesLoaded(): Conf<Record<string, unknown>> {
    if (!this.rolesPath || !this.rolesStore) {
      throw new Error('角色配置未加载');
    }
    return this.rolesStore;
  }

  private requireConfigCache(): AppConfig {
    if (!this.lastKnownConfig) {
      throw new Error('配置未加载');
    }
    return this.lastKnownConfig;
  }

  private requireRolesCache(): readonly RoleConfig[] {
    if (!this.lastKnownRoles) {
      throw new Error('角色配置未加载');
    }
    return this.lastKnownRoles;
  }

  private readValidatedConfigFromStore(): AppConfig {
    const parsed = this.ensureLoaded().store;
    if (!isRecord(parsed)) {
      throw new Error('配置验证失败');
    }

    const merged = mergeDefaults(
      structuredClone(DEFAULT_CONFIG) as Record<string, unknown>,
      parsed as Record<string, unknown>,
    ) as AppConfig;
    const validated = this.validateWithSchema<AppConfig>(
      AppConfigSchema,
      merged,
      '配置',
    );

    const missingFields = this.findMissingFields(
      parsed as Record<string, unknown>,
      validated as Record<string, unknown>,
    );

    if (missingFields.length > 0) {
      logger.warn('配置存在缺失字段 —— 已用默认值修补', {
        missing: missingFields.join(', '),
      });

      this.writeConfigToStore(validated);
    }

    return validated;
  }

  private readValidatedRolesFromStore(): RoleConfig[] {
    const raw = this.ensureRolesLoaded().store[this.ROLES_STORE_KEY];
    const validated = this.validateWithSchema<RoleConfig[]>(RolesConfigSchema, raw, '角色配置');
    const roles = normaliseRoles(validated);
    this.assertUniqueRoleIds(roles);
    return roles;
  }

  private writeConfigToStore(config: AppConfig): void {
    this.ensureLoaded().store = structuredClone(config) as Record<string, unknown>;
  }

  private writeRolesToStore(roles: readonly RoleConfig[]): void {
    this.ensureRolesLoaded().store = {
      [this.ROLES_STORE_KEY]: structuredClone(roles),
    } as Record<string, unknown>;
  }

  private persistWithGuard(config: AppConfig): void {
    this.selfUpdating = true;
    try {
      this.writeConfigToStore(config);
      this.lastKnownConfig = structuredClone(config);
    } finally {
      setTimeout(() => {
        this.selfUpdating = false;
        if (this.reloadAfterGuard) {
          this.reloadAfterGuard = false;
          void this.reloadFromFile();
        }
      }, this.DEBOUNCE_MS + 50);
    }
  }

  private persistRolesWithGuard(roles: readonly RoleConfig[]): void {
    this.rolesSelfUpdating = true;
    try {
      this.writeRolesToStore(roles);
      this.lastKnownRoles = structuredClone(roles);
    } finally {
      setTimeout(() => {
        this.rolesSelfUpdating = false;
        if (this.reloadRolesAfterGuard) {
          this.reloadRolesAfterGuard = false;
          void this.reloadRolesFromFile();
        }
      }, this.DEBOUNCE_MS + 50);
    }
  }

  private createConfigStore(configPath: string): Conf<Record<string, unknown>> {
    const extension = extname(configPath);
    const fileExtension = extension.startsWith('.') ? extension.slice(1) : extension;

    try {
      return new Conf<Record<string, unknown>>({
        cwd: dirname(configPath),
        configName: extension ? basename(configPath, extension) : basename(configPath),
        fileExtension,
        clearInvalidConfig: false,
        serialize: (value) => JSON.stringify(value, null, 2),
        deserialize: JSON.parse,
        watch: true,
      });
    } catch (err) {
      throw new Error('配置文件中的 JSON 无效', { cause: err });
    }
  }

  private createRolesStore(rolesPath: string): Conf<Record<string, unknown>> {
    const extension = extname(rolesPath);
    const fileExtension = extension.startsWith('.') ? extension.slice(1) : extension;

    try {
      return new Conf<Record<string, unknown>>({
        cwd: dirname(rolesPath),
        configName: extension ? basename(rolesPath, extension) : basename(rolesPath),
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

/**
 * 把点号 key(如 `'channels.testchannel'`)与值
 * 转换为嵌套对象 `{ channels: { testchannel: value } }`,
 * 供 `syncDefaults()` 与默认配置合并使用。
 */
function buildNestedObject(key: string, value: Record<string, unknown>): Record<string, unknown> {
  const parts = key.split('.');
  const result: Record<string, unknown> = {};
  let current = result;

  for (let i = 0; i < parts.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- loop guard ensures parts[i] is defined
    const part = parts[i]!;
    if (i === parts.length - 1) {
      current[part] = value;
    } else {
      current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
  }

  return result;
}

function parsePath(path: string): string[] {
  const parts = path.split('.').filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error('配置路径不能为空');
  }
  return parts;
}

function getPathValue(root: Record<string, unknown>, path: string): unknown {
  const parts = parsePath(path);
  let current: unknown = root;
  for (const part of parts) {
    if (Array.isArray(current)) {
      throw new Error(`配置路径 "${path}" 不能访问数组路径`);
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function setPathValue(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = parsePath(path);
  let current: Record<string, unknown> = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined) {
      throw new Error('配置路径不能为空');
    }
    const next = current[part];
    if (Array.isArray(next)) {
      throw new Error(`配置路径 "${path}" 不能访问数组路径`);
    }
    if (next === undefined) {
      current[part] = {};
      current = current[part] as Record<string, unknown>;
      continue;
    }
    if (!isRecord(next)) {
      throw new Error(`配置路径 "${path}" 的中间节点不是对象`);
    }
    current = next;
  }

  const leaf = parts[parts.length - 1];
  if (leaf === undefined) {
    throw new Error('配置路径不能为空');
  }
  current[leaf] = structuredClone(value);
}

function normaliseRoles(roles: readonly RoleConfig[]): RoleConfig[] {
  return roles.map((role) => (role.id === 'default' ? { ...role, enabled: true } : role));
}
