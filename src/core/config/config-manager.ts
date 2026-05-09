import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import Conf from 'conf';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { isRecord, mergeDefaults } from '@aesyclaw/core/utils';
import { resolvePaths, type ResolvedPaths } from '@aesyclaw/core/path-resolver';
import { AsyncMutex } from '@aesyclaw/core/mutex';
import { AppConfigSchema, type AppConfig } from './schema';
import { DEFAULT_CONFIG } from './defaults';

const logger = createScopedLogger('config-manager');

export class ConfigManager {
  private readonly paths: ResolvedPaths;
  private lastKnownConfig: AppConfig;
  private registeredDefaults = new Map<string, Record<string, unknown>>();
  private readonly configStore: Conf<Record<string, unknown>>;
  private unsubscribeHotReload?: () => void;

  private configMutex = new AsyncMutex();

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
  }

  /** 获取已解析的运行时路径（只读）。 */
  get resolvedPaths(): Readonly<ResolvedPaths> {
    return this.paths;
  }

  /**
   * 按点分隔路径读取配置值。
   *
   * @param path - 点分隔的配置路径，如 "server.port"
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
    const validatedConfig = this.validateWithSchema<AppConfig>(AppConfigSchema, nextConfig, '配置');
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
    const validatedConfig = this.validateWithSchema<AppConfig>(
      AppConfigSchema,
      mergedConfig,
      '配置',
    );

    await this.persistWithGuard(validatedConfig);
  }

  /** 启动配置文件热重载监视器。 */
  startHotReload(): void {
    this.stopHotReload();

    this.unsubscribeHotReload = this.configStore.onDidAnyChange(() => {
      void this.reloadFromFile();
    });

    logger.info('热重载监视器已启动');
  }

  /** 停止配置文件热重载监视器。 */
  stopHotReload(): void {
    this.unsubscribeHotReload?.();
    this.unsubscribeHotReload = undefined;
    logger.info('热重载监视器已停止');
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

  private writeConfigToStore(store: Conf<Record<string, unknown>>, config: AppConfig): void {
    store.store = structuredClone(config) as Record<string, unknown>;
  }

  private async persistWithGuard(config: AppConfig): Promise<void> {
    await this.configMutex.runExclusive(async () => {
      this.writeConfigToStore(this.configStore, config);
      this.lastKnownConfig = structuredClone(config);
    });
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
      throw new Error('配置文件中的 JSON 无效', { cause: err });
    }
  }
}

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

  const lastPart = parts[parts.length - 1];
  if (lastPart === undefined) {
    throw new Error('配置路径解析错误：意外的 undefined 最后部分');
  }
  current[lastPart] = value;
}