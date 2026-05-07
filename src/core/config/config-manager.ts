/**
 * ConfigManager — 加载、验证、缓存、热重载配置。
 *
 * 关键行为：
 * - 构造时自动初始化，从 `root/.aesyclaw/` 加载配置
 * - 缺失文件时创建默认配置
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
import { resolvePaths, type ResolvedPaths } from '@aesyclaw/core/path-resolver';
import { DEFAULT_ROLES_CONFIG } from '@aesyclaw/role/default-role';
import { RolesConfigSchema } from '@aesyclaw/role/role-schema';
import { AppConfigSchema } from './schema';
import type { AppConfig } from './schema';
import { DEFAULT_CONFIG } from './defaults';

const logger = createScopedLogger('config-manager');

export class ConfigManager {
  private readonly ROLES_STORE_KEY = 'roles';
  private readonly paths: ResolvedPaths;
  private lastKnownConfig: AppConfig;
  private lastKnownRoles: readonly RoleConfig[];
  private registeredDefaults = new Map<string, Record<string, unknown>>();
  private readonly configStore: Conf<Record<string, unknown>>;
  private readonly rolesStore: Conf<Record<string, unknown>>;
  private unsubscribeHotReload?: () => void;
  private unsubscribeRolesHotReload?: () => void;

  // 互斥锁队列：确保配置/角色操作按顺序执行
  private configMutex = new AsyncMutex();
  private rolesMutex = new AsyncMutex();

  // ─── 生命周期 ────────────────────────────────────────────────

  /**
   * 构造时自动初始化 —— 解析路径、创建目录、加载配置。
   *
   * @param root - 项目根目录，默认 process.cwd()
   * @throws 配置或角色文件加载失败时抛出异常
   */
  constructor(root: string = process.cwd()) {
    this.paths = resolvePaths(root);
    this.ensureRuntimeDirs();

    // 加载配置文件
    try {
      const loaded = this.loadConfig();
      this.configStore = loaded.store;
      this.lastKnownConfig = loaded.config;
    } catch (err) {
      logger.error('加载配置失败', err);
      throw err;
    }

    // 加载角色文件
    try {
      const loaded = this.loadRoles();
      this.rolesStore = loaded.store;
      this.lastKnownRoles = loaded.roles;
    } catch (err) {
      logger.error('加载角色配置失败', err);
      throw err;
    }

    logger.info('配置已加载', {
      configFile: this.paths.configFile,
      rolesFile: this.paths.rolesFile,
    });
  }

  /** 创建运行时目录 */
  private ensureRuntimeDirs(): void {
    const runtimeDirs = [
      this.paths.runtimeRoot,
      this.paths.dataDir,
      this.paths.mediaDir,
      this.paths.workspaceDir,
      this.paths.userSkillsDir,
    ];

    for (const dir of runtimeDirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /** 加载配置文件，缺失时创建默认 */
  private loadConfig(): {
    store: Conf<Record<string, unknown>>;
    config: AppConfig;
  } {
    const configPath = this.paths.configFile;
    mkdirSync(dirname(configPath), { recursive: true });

    if (!existsSync(configPath)) {
      logger.info('未找到配置文件，正在使用默认值创建', { path: configPath });
      const store = this.createConfigStore(configPath);
      this.writeConfigToStore(store, DEFAULT_CONFIG);
      return { store, config: structuredClone(DEFAULT_CONFIG) };
    }

    logger.info('正在加载配置', { path: configPath });
    const store = this.createConfigStore(configPath);
    const config = this.readValidatedConfigFromStore(store);
    return { store, config };
  }

  /** 加载角色文件，缺失时创建默认 */
  private loadRoles(): {
    store: Conf<Record<string, unknown>>;
    roles: readonly RoleConfig[];
  } {
    const rolesPath = this.paths.rolesFile;
    mkdirSync(dirname(rolesPath), { recursive: true });

    if (!existsSync(rolesPath)) {
      logger.info('未找到角色配置文件，正在使用默认值创建', { path: rolesPath });
      const store = this.createRolesStore(rolesPath);
      this.writeRolesToStore(store, DEFAULT_ROLES_CONFIG);
      return { store, roles: structuredClone(DEFAULT_ROLES_CONFIG) };
    }

    logger.info('正在加载角色配置', { path: rolesPath });
    const store = this.createRolesStore(rolesPath);
    const roles = this.readValidatedRolesFromStore(store);
    return { store, roles };
  }

  /** 获取解析后的路径集合（只读） */
  get resolvedPaths(): Readonly<ResolvedPaths> {
    return this.paths;
  }

  // ─── 读取 ──────────────────────────────────────────────────────

  /** 获取配置路径的只读快照；路径不存在时返回 undefined。 */
  get(path: string): unknown {
    const value = getPathValue(this.lastKnownConfig as Record<string, unknown>, path);
    return value === undefined ? undefined : structuredClone(value);
  }

  /** 获取角色配置快照。 */
  getRoles(): readonly RoleConfig[] {
    return structuredClone(this.lastKnownRoles);
  }

  // ─── 写入 ─────────────────────────────────────────────────────

  /** 替换配置路径并持久化。 */
  async set(path: string, value: unknown): Promise<void> {
    const nextConfig = structuredClone(this.lastKnownConfig) as Record<string, unknown>;
    setPathValue(nextConfig, path, value);
    const validatedConfig = this.validateWithSchema<AppConfig>(AppConfigSchema, nextConfig, '配置');
    await this.persistWithGuard(validatedConfig);
  }

  /** 深合并对象配置路径并持久化。 */
  async patch(path: string, value: Record<string, unknown>): Promise<void> {
    if (!isRecord(value)) {
      throw new Error('patch 值必须是对象');
    }

    const nextConfig = structuredClone(this.lastKnownConfig) as Record<string, unknown>;
    const current = getPathValue(nextConfig, path);
    if (current !== undefined && !isRecord(current)) {
      throw new Error(`配置路径 "${path}" 不是对象，不能 patch`);
    }

    const merged = mergeDefaults((current ?? {}) as Record<string, unknown>, value);
    setPathValue(nextConfig, path, merged);
    const validatedConfig = this.validateWithSchema<AppConfig>(AppConfigSchema, nextConfig, '配置');
    await this.persistWithGuard(validatedConfig);
  }

  /** 替换并持久化完整角色数组。 */
  async setRoles(roles: readonly RoleConfig[]): Promise<void> {
    const oldRoles = this.lastKnownRoles;
    const validated = this.validateWithSchema<RoleConfig[]>(RolesConfigSchema, roles, '角色配置');
    const newRoles = normaliseRoles(validated);
    this.assertUniqueRoleIds(newRoles);

    if (JSON.stringify(oldRoles) === JSON.stringify(newRoles)) {
      return;
    }

    await this.persistRolesWithGuard(newRoles);
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
    let mergedConfig = structuredClone(this.lastKnownConfig);
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

    await this.persistWithGuard(validatedConfig);
  }

  // ─── 热重载 ─────────────────────────────────────────────────

  /** 开始监视配置文件的外部变更 */
  startHotReload(): void {
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
    this.unsubscribeHotReload?.();
    this.unsubscribeHotReload = undefined;
    this.unsubscribeRolesHotReload?.();
    this.unsubscribeRolesHotReload = undefined;
    logger.info('热重载监视器已停止');
  }

  // ─── 私有辅助函数 ───────────────────────────────────────────

  private async reloadFromFile(): Promise<void> {
    // 使用互斥锁确保与写入操作串行执行
    await this.configMutex.runExclusive(async () => {
      try {
        const newConfig = this.readValidatedConfigFromStore(this.configStore);
        if (JSON.stringify(this.lastKnownConfig) === JSON.stringify(newConfig)) {
          logger.debug('配置文件已变更但内容相同 —— 跳过');
          return;
        }
        this.lastKnownConfig = structuredClone(newConfig);
        logger.info('已从文件重新加载配置缓存');
      } catch (err) {
        logger.error('重新加载配置文件失败，继续使用上一次有效配置', err);
      }
    });
  }

  private async reloadRolesFromFile(): Promise<void> {
    // 使用互斥锁确保与写入操作串行执行
    await this.rolesMutex.runExclusive(async () => {
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
    });
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

  private readValidatedConfigFromStore(store: Conf<Record<string, unknown>>): AppConfig {
    const parsed = store.store;
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

      this.writeConfigToStore(store, validated);
    }

    return validated;
  }

  private readValidatedRolesFromStore(store: Conf<Record<string, unknown>>): RoleConfig[] {
    const raw = store.store[this.ROLES_STORE_KEY];
    const validated = this.validateWithSchema<RoleConfig[]>(RolesConfigSchema, raw, '角色配置');
    const roles = normaliseRoles(validated);
    this.assertUniqueRoleIds(roles);
    return roles;
  }

  private writeConfigToStore(store: Conf<Record<string, unknown>>, config: AppConfig): void {
    store.store = structuredClone(config) as Record<string, unknown>;
  }

  private writeRolesToStore(store: Conf<Record<string, unknown>>, roles: readonly RoleConfig[]): void {
    store.store = {
      [this.ROLES_STORE_KEY]: structuredClone(roles),
    } as Record<string, unknown>;
  }

  private async persistWithGuard(config: AppConfig): Promise<void> {
    // 使用互斥锁确保与重载操作串行执行
    await this.configMutex.runExclusive(async () => {
      this.writeConfigToStore(this.configStore, config);
      this.lastKnownConfig = structuredClone(config);
    });
  }

  private async persistRolesWithGuard(roles: readonly RoleConfig[]): Promise<void> {
    // 使用互斥锁确保与重载操作串行执行
    await this.rolesMutex.runExclusive(async () => {
      this.writeRolesToStore(this.rolesStore, roles);
      this.lastKnownRoles = structuredClone(roles);
    });
  }

  private createConfigStore(configPath: string): Conf<Record<string, unknown>> {
    return this.createStore(configPath, {
      serialize: (value) => JSON.stringify(value, null, 2),
      deserialize: JSON.parse,
    });
  }

  private createRolesStore(rolesPath: string): Conf<Record<string, unknown>> {
    return this.createStore(rolesPath, {
      serialize: (value) => JSON.stringify(value[this.ROLES_STORE_KEY] ?? [], null, 2),
      deserialize: (value) => ({ [this.ROLES_STORE_KEY]: JSON.parse(value) }),
    });
  }

  private createStore(
    filePath: string,
    options: {
      serialize: (value: Record<string, unknown>) => string;
      deserialize: (value: string) => Record<string, unknown>;
    },
  ): Conf<Record<string, unknown>> {
    const extension = extname(filePath);
    const fileExtension = extension.startsWith('.') ? extension.slice(1) : extension;

    try {
      return new Conf<Record<string, unknown>>({
        cwd: dirname(filePath),
        configName: extension ? basename(filePath, extension) : basename(filePath),
        fileExtension,
        clearInvalidConfig: false,
        serialize: options.serialize,
        deserialize: options.deserialize,
        watch: true,
      });
    } catch (err) {
      throw new Error('配置文件中的 JSON 无效', { cause: err });
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
  if (parts.length === 0 || parts[0] === '') {
    return value;
  }

  const result: Record<string, unknown> = {};
  let current = result;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined || part === '') continue;

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
      throw new Error('配置路径解析错误：意外的 undefined 部分');
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

  // 注意：调用方已 clone 整个 config，此处直接赋值
  const lastPart = parts[parts.length - 1];
  if (lastPart === undefined) {
    throw new Error('配置路径解析错误：意外的 undefined 最后部分');
  }
  current[lastPart] = value;
}

function normaliseRoles(roles: readonly RoleConfig[]): RoleConfig[] {
  return roles.map((role) => (role.id === 'default' ? { ...role, enabled: true } : role));
}

/**
 * 异步互斥锁 — 确保异步操作按顺序执行。
 *
 * 使用 Promise 队列实现：当锁被持有时，新请求会排队等待；
 * 当前操作完成后，队列中的下一个操作开始执行。
 */
class AsyncMutex {
  private queue: Array<() => Promise<void>> = [];
  private locked = false;

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const run = async (): Promise<void> => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.locked = false;
          this.dequeue();
        }
      };

      if (this.locked) {
        this.queue.push(run);
      } else {
        this.locked = true;
        void run();
      }
    });
  }

  private dequeue(): void {
    const next = this.queue.shift();
    if (next) {
      this.locked = true;
      void next();
    }
  }
}
