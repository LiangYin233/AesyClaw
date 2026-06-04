import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';

import Conf from 'conf';
import { getProperty, setProperty } from 'dot-prop';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { isRecord, mergeDefaults } from '@aesyclaw/core/utils';
import { resolvePaths, type ResolvedPaths } from '@aesyclaw/core/path-resolver';
import { validateWithSchema } from './schema-utils';
import { AppConfigSchema, type AppConfig } from './schema';
import { DEFAULT_CONFIG } from './defaults';
import { ConfigFileWatcher } from './file-watcher';
import { ErrorFactory } from '@aesyclaw/core/errors';

const logger = createScopedLogger('config-manager');

export class ConfigManager {
  private readonly paths: ResolvedPaths;
  private lastKnownConfig: AppConfig;
  private registeredDefaults = new Map<string, Record<string, unknown>>();
  private readonly configStore: Conf<Record<string, unknown>>;
  private readonly fileWatcher: ConfigFileWatcher;
  private readonly configChangedListeners = new Set<() => void>();

  /**
   * 创建配置管理器实例。
   *
   * 初始化时将加载或创建配置文件，并确保运行时目录存在。
   *
   * @param root - 项目根目录，默认为 process.cwd()
   */
  constructor(root: string = process.cwd()) {
    this.paths = resolvePaths(root);
    this.ensureRuntimeDirs();

    try {
      const loaded = this.loadConfig();
      this.configStore = loaded.store;
      this.lastKnownConfig = loaded.config;
    } catch (err) {
      logger.error('加载配置失败', err);
      throw err;
    }

    logger.info('配置已加载', {
      configFile: this.paths.configFile,
    });

    this.fileWatcher = new ConfigFileWatcher(() => {
      void this.reloadFromFile();
    });
  }

  /** 获取已解析的运行时路径（只读）。 */
  get resolvedPaths(): Readonly<ResolvedPaths> {
    return this.paths;
  }

  /** 订阅配置变更通知，返回取消订阅函数。 */
  subscribeConfigChanged(listener: () => void): () => void {
    this.configChangedListeners.add(listener);
    return () => {
      this.configChangedListeners.delete(listener);
    };
  }

  /**
   * 按点分隔路径读取配置值。
   *
   * @param path - 点分隔的配置路径，如 "agent.defaultModel"
   * @returns 配置值的深拷贝，路径不存在时返回 undefined
   */
  get(path: string): unknown {
    const value = getPathValue(this.lastKnownConfig as Record<string, unknown>, path);
    return value === undefined ? undefined : structuredClone(value);
  }

  /**
   * 按点分隔路径设置配置值，验证后持久化。
   *
   * @param path - 点分隔的配置路径
   * @param value - 要设置的新值
   */
  async set(path: string, value: unknown): Promise<void> {
    const nextConfig = structuredClone(this.lastKnownConfig) as Record<string, unknown>;
    setPathValue(nextConfig, path, value);
    const validatedConfig = validateWithSchema<AppConfig>(AppConfigSchema, nextConfig, '配置');
    await this.persistWithGuard(validatedConfig);
  }

  /**
   * 合并补丁到配置路径的当前值，验证后持久化。
   *
   * @param path - 点分隔的配置路径（必须是对象类型）
   * @param value - 要合并到现有值的对象
   * @throws Error 如果路径值不是对象或路径不存在
   */
  async patch(path: string, value: Record<string, unknown>): Promise<void> {
    if (!isRecord(value)) {
      throw ErrorFactory.config.invalid('patch 值必须是对象', { configPath: path });
    }

    const nextConfig = structuredClone(this.lastKnownConfig) as Record<string, unknown>;
    const current = getPathValue(nextConfig, path);
    if (current !== undefined && !isRecord(current)) {
      throw ErrorFactory.config.invalid(`配置路径 "${path}" 不是对象，不能 patch`, {
        configPath: path,
      });
    }

    const merged = mergeDefaults((current ?? {}) as Record<string, unknown>, value);
    setPathValue(nextConfig, path, merged);
    const validatedConfig = validateWithSchema<AppConfig>(AppConfigSchema, nextConfig, '配置');
    await this.persistWithGuard(validatedConfig);
  }

  /**
   * 原子应用多个顶层配置更新。
   *
   * agent 作为对象 patch 合并；providers / channels / mcp / plugins 整段替换。
   * 所有变更会先在内存中合成并整体校验，校验通过后才持久化，避免半更新状态。
   *
   * @param update - 顶层配置更新对象
   */
  async update(update: Record<string, unknown>): Promise<void> {
    if (!isRecord(update)) {
      throw ErrorFactory.config.invalid('update 值必须是对象', { configPath: '<root>' });
    }

    const nextConfig = structuredClone(this.lastKnownConfig) as Record<string, unknown>;
    for (const [key, value] of Object.entries(update)) {
      applyTopLevelConfigUpdate(nextConfig, key, value);
    }

    const validatedConfig = validateWithSchema<AppConfig>(AppConfigSchema, nextConfig, '配置');
    await this.persistWithGuard(validatedConfig);
  }

  /**
   * 注册键对应的默认值，供后续 syncDefaults 合并使用。
   *
   * @param key - 默认值注册键（支持点分隔路径）
   * @param defaults - 要注册的默认值对象
   */
  registerDefaults(key: string, defaults: Record<string, unknown>): void {
    this.registeredDefaults.set(key, defaults);
  }

  /**
   * 将所有已注册的默认值合并到当前配置并持久化。
   *
   * 不覆盖已有值，仅补充缺失字段。
   */
  async syncDefaults(): Promise<void> {
    let mergedConfig = structuredClone(this.lastKnownConfig);
    for (const [key, defaults] of this.registeredDefaults) {
      const nestedPartial = buildNestedObject(key, defaults);
      mergedConfig = mergeDefaults(mergedConfig as Record<string, unknown>, nestedPartial, {
        overwrite: false,
      }) as AppConfig;
    }
    const validatedConfig = validateWithSchema<AppConfig>(AppConfigSchema, mergedConfig, '配置');

    await this.persistWithGuard(validatedConfig);
  }

  /** 启动配置文件热重载监视器。 */
  startHotReload(): void {
    this.fileWatcher.start(this.configStore, this.paths.configFile);
  }

  /** 停止配置文件热重载监视器。 */
  stopHotReload(): void {
    this.fileWatcher.stop();
  }

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

  private loadConfig(): {
    store: Conf<Record<string, unknown>>;
    config: AppConfig;
  } {
    const configPath = this.paths.configFile;
    mkdirSync(dirname(configPath), { recursive: true });

    if (!existsSync(configPath)) {
      logger.info('未找到配置文件，正在使用默认值创建', { path: configPath });
      const store = this.createStore(configPath);
      this.writeConfigToStore(store, DEFAULT_CONFIG);
      return { store, config: structuredClone(DEFAULT_CONFIG) };
    }

    logger.info('正在加载配置', { path: configPath });
    const store = this.createStore(configPath);
    const config = this.readValidatedConfigFromStore(store);
    return { store, config };
  }

  private async reloadFromFile(): Promise<void> {
    try {
      const newConfig = this.readValidatedConfigFromFile();
      if (JSON.stringify(this.lastKnownConfig) === JSON.stringify(newConfig)) {
        logger.debug('配置文件已变更但内容相同 —— 跳过');
        return;
      }
      this.lastKnownConfig = structuredClone(newConfig);
      logger.info('已从文件重新加载配置缓存');
      this.notifyConfigChanged();
    } catch (err) {
      logger.error('重新加载配置文件失败，继续使用上一次有效配置', err);
    }
  }

  private readValidatedConfigFromStore(store: Conf<Record<string, unknown>>): AppConfig {
    return this.readValidatedConfig(store.store, store);
  }

  private readValidatedConfigFromFile(): AppConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.paths.configFile, 'utf-8'));
    } catch (err) {
      throw ErrorFactory.config.parseFailed(
        this.paths.configFile,
        'JSON 无效',
        {},
        err instanceof Error ? err : undefined,
      );
    }
    return this.readValidatedConfig(parsed, this.configStore);
  }

  private readValidatedConfig(parsed: unknown, store?: Conf<Record<string, unknown>>): AppConfig {
    if (!isRecord(parsed)) {
      throw ErrorFactory.config.validationFailed('配置验证失败', {
        expected: 'object',
        actual: typeof parsed,
      });
    }

    const merged = mergeDefaults(
      structuredClone(DEFAULT_CONFIG) as Record<string, unknown>,
      parsed as Record<string, unknown>,
    ) as AppConfig;
    const validated = validateWithSchema<AppConfig>(AppConfigSchema, merged, '配置');

    const missingFields = this.findMissingFields(
      parsed as Record<string, unknown>,
      validated as Record<string, unknown>,
    );

    if (missingFields.length > 0 && store !== undefined) {
      logger.warn('配置存在缺失字段 —— 已用默认值修补', {
        missing: missingFields.join(', '),
      });

      this.writeConfigToStore(store, validated);
    }

    return validated;
  }

  private writeConfigToStore(store: Conf<Record<string, unknown>>, config: AppConfig): void {
    store.store = structuredClone(config) as Record<string, unknown>;
  }

  private async persistWithGuard(config: AppConfig): Promise<void> {
    if (configsEqual(this.lastKnownConfig, config)) return;

    this.writeConfigToStore(this.configStore, config);
    this.lastKnownConfig = structuredClone(config);
    this.notifyConfigChanged();
  }

  private notifyConfigChanged(): void {
    for (const listener of this.configChangedListeners) {
      try {
        listener();
      } catch (err) {
        logger.error('配置变更监听器执行失败', err);
      }
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
      } else if (isRecord(validated[key]) && isRecord(parsed[key])) {
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

  private createStore(filePath: string): Conf<Record<string, unknown>> {
    const extension = extname(filePath);
    const fileExtension = extension.startsWith('.') ? extension.slice(1) : extension;

    try {
      return new Conf<Record<string, unknown>>({
        cwd: dirname(filePath),
        configName: extension ? basename(filePath, extension) : basename(filePath),
        fileExtension,
        clearInvalidConfig: false,
        serialize: (value) => JSON.stringify(value, null, 2),
        deserialize: JSON.parse,
        watch: true,
      });
    } catch (err) {
      throw ErrorFactory.config.parseFailed(
        filePath,
        'JSON 无效',
        {},
        err instanceof Error ? err : undefined,
      );
    }
  }
}

function configsEqual(left: AppConfig, right: AppConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyTopLevelConfigUpdate(
  config: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (key === 'agent') {
    if (!isRecord(value)) {
      throw ErrorFactory.config.invalid(`配置段 "${key}" 的 patch 值必须是对象`, {
        configPath: key,
      });
    }
    const current = config[key];
    if (current !== undefined && !isRecord(current)) {
      throw ErrorFactory.config.invalid(`配置段 "${key}" 当前值不是对象，不能 patch`, {
        configPath: key,
      });
    }
    config[key] = mergeDefaults((current ?? {}) as Record<string, unknown>, value);
    return;
  }

  if (key === 'providers' || key === 'channels' || key === 'mcp' || key === 'plugins') {
    config[key] = value;
    return;
  }

  throw ErrorFactory.config.invalid(`不支持的配置段 "${key}"`, { configPath: key });
}

function buildNestedObject(key: string, value: Record<string, unknown>): Record<string, unknown> {
  const parts = key.split('.').filter((part) => part.length > 0);
  if (parts.length === 0) {
    return value;
  }

  const result: Record<string, unknown> = {};
  setProperty(result, parts, value);
  return result;
}

function parsePath(path: string): string[] {
  const parts = path.split('.').filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw ErrorFactory.config.invalid('配置路径不能为空', { configPath: path });
  }
  return parts;
}

function getPathValue(root: Record<string, unknown>, path: string): unknown {
  const parts = parsePath(path);
  assertObjectPath(root, parts, path);
  return getProperty(root, parts);
}

function setPathValue(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = parsePath(path);
  assertObjectPath(root, parts, path, { allowMissing: true });
  setProperty(root, parts, value);
}

function assertObjectPath(
  root: Record<string, unknown>,
  parts: string[],
  path: string,
  options: { allowMissing?: boolean } = {},
): void {
  let current: unknown = root;
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(current)) {
      throw ErrorFactory.config.invalid(`配置路径 "${path}" 不能访问数组路径`, {
        configPath: path,
      });
    }
    if (!isRecord(current)) {
      if (options.allowMissing) {
        throw ErrorFactory.config.invalid(`配置路径 "${path}" 的中间节点不是对象`, {
          configPath: path,
        });
      }
      return;
    }

    const next = current[part];
    if (Array.isArray(next)) {
      throw ErrorFactory.config.invalid(`配置路径 "${path}" 不能访问数组路径`, {
        configPath: path,
      });
    }
    if (next === undefined) {
      if (options.allowMissing) {
        return;
      }
      return;
    }
    if (!isRecord(next)) {
      if (options.allowMissing) {
        throw ErrorFactory.config.invalid(`配置路径 "${path}" 的中间节点不是对象`, {
          configPath: path,
        });
      }
      return;
    }
    current = next;
  }
}
