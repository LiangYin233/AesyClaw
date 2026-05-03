/**
 * ConfigManager — 加载、验证、热重载配置并在变更时通知。
 *
 * 关键行为：
 * - 从 JSON 文件加载配置；缺失时创建默认配置
 * - TypeBox 验证，缺失字段回退到默认值
 * - `subscribe(key)` / `subscribeAll()` 用于变更通知
 * - `update(partial)` 合并并持久化；设置 `selfUpdating` 守卫以防止
 *   Conf `onDidAnyChange` 导致的无限重载循环
 * - `registerDefaults` / `syncDefaults` 供子系统声明默认值
 */

import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import Conf from 'conf';
import type { DeepPartial, ConfigChangeListener, Unsubscribe } from '../types';
import { createScopedLogger } from '../logger';
import { isRecord, mergeDefaults } from '../utils';
import { AppConfigSchema } from './schema';
import type { AppConfig } from './schema';
import { DEFAULT_CONFIG } from './defaults';

const logger = createScopedLogger('config-manager');

export type ConfigManagerDependencies = {
  configPath: string;
};

type ListenerEntry = {
  key?: keyof AppConfig;
  listener: ConfigChangeListener<unknown>;
};

export class ConfigManager {
  private configPath: string | null = null;
  private lastKnownConfig: AppConfig | null = null;
  private listeners: ListenerEntry[] = [];
  private registeredDefaults = new Map<string, Record<string, unknown>>();
  private configStore: Conf<Record<string, unknown>> | null = null;
  private selfUpdating = false;
  private readonly DEBOUNCE_MS = 300;
  private unsubscribeHotReload?: () => void;

  // ─── 生命周期 ────────────────────────────────────────────────

  /**
   * 标准管理器生命周期入口 —— 委托给 {@link load}。
   */
  async initialize(deps: ConfigManagerDependencies): Promise<void> {
    await this.load(deps.configPath);
  }

  /**
   * 从给定路径加载配置。
   * 如果文件不存在，则使用默认值创建。
   */
  async load(configPath: string): Promise<void> {
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

  // ─── 读取 ──────────────────────────────────────────────────────

  /** 获取整个配置的只读快照 */
  getConfig(): Readonly<AppConfig> {
    return this.readValidatedConfigFromStore();
  }

  /** 获取特定配置节的只读快照 */
  get<K extends keyof AppConfig>(key: K): Readonly<AppConfig[K]> {
    return this.readValidatedConfigFromStore()[key];
  }

  // ─── 订阅 ─────────────────────────────────────────────────

  /** 订阅特定配置键的变更 */
  subscribe<K extends keyof AppConfig>(
    key: K,
    listener: ConfigChangeListener<AppConfig[K]>,
  ): Unsubscribe {
    const entry: ListenerEntry = { key, listener: listener as ConfigChangeListener<unknown> };
    this.listeners.push(entry);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  /** 订阅任意配置变更 */
  subscribeAll(listener: ConfigChangeListener<AppConfig>): Unsubscribe {
    const entry: ListenerEntry = { listener: listener as ConfigChangeListener<unknown> };
    this.listeners.push(entry);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  // ─── 写入 ─────────────────────────────────────────────────────

  /**
   * 将部分配置合并到当前状态并持久化到磁盘。
   * 设置 `selfUpdating` 守卫，使由此产生的文件写入不会
   * 触发冗余的重载循环。
   */
  async update(
    partial: DeepPartial<AppConfig>,
    options: { replaceTopLevelKeys?: readonly (keyof AppConfig)[] } = {},
  ): Promise<void> {
    this.ensureLoaded();

    const oldConfig = this.readValidatedConfigFromStore();
    const mergeBase = structuredClone(oldConfig) as Record<string, unknown>;

    for (const key of options.replaceTopLevelKeys ?? []) {
      if (Object.prototype.hasOwnProperty.call(partial, key)) {
        delete mergeBase[key];
      }
    }

    const mergedConfig = mergeDefaults(
      mergeBase,
      partial as Record<string, unknown>,
    ) as AppConfig;
    const validatedConfig = this.validateConfigObject(mergedConfig);

    this.persistWithGuard(validatedConfig);
    this.notifyListeners(oldConfig, validatedConfig);
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

    const oldConfig = this.readValidatedConfigFromStore();
    let mergedConfig = structuredClone(oldConfig);
    for (const [key, defaults] of this.registeredDefaults) {
      const nestedPartial = buildNestedObject(key, defaults);
      mergedConfig = mergeDefaults(
        mergedConfig as Record<string, unknown>,
        nestedPartial,
        { overwrite: false },
      ) as AppConfig;
    }
    const validatedConfig = this.validateConfigObject(mergedConfig);

    this.persistWithGuard(validatedConfig);
    this.notifyListeners(oldConfig, validatedConfig);
  }

  // ─── 热重载 ─────────────────────────────────────────────────

  /** 开始监视配置文件的外部变更 */
  startHotReload(): void {
    if (!this.configPath || !this.configStore) {
      throw new Error('配置未加载 —— 无法启动热重载');
    }

    this.stopHotReload();

    this.unsubscribeHotReload = this.configStore.onDidAnyChange(() => {
      this.reloadFromFile();
    });

    logger.info('热重载监视器已启动');
  }

  /** 停止监视配置文件 */
  stopHotReload(): void {
    if (this.unsubscribeHotReload) {
      this.unsubscribeHotReload();
      this.unsubscribeHotReload = undefined;
      logger.info('热重载监视器已停止');
    }
  }

  // ─── 私有辅助函数 ───────────────────────────────────────────

  private reloadFromFile(): void {
    if (!this.configStore) return;

    // 如果刚写入文件 ourselves，则跳过
    if (this.selfUpdating) {
      return;
    }

    try {
      const oldConfig = this.lastKnownConfig ?? this.readValidatedConfigFromStore();
      const newConfig = this.validateConfigPayload(this.configStore.store);

      // 比较规范化 JSON 以检测真实变更
      const oldNormalised = JSON.stringify(oldConfig);
      const newNormalised = JSON.stringify(newConfig);

      if (oldNormalised === newNormalised) {
        logger.debug('配置文件已变更但内容相同 —— 跳过');
        return;
      }

      this.lastKnownConfig = structuredClone(newConfig);
      this.notifyListeners(oldConfig, newConfig);
      logger.info('已从文件重新加载配置');
    } catch (err) {
      logger.error('重新加载配置文件失败', err);
    }
  }

  private validateConfigPayload(parsed: unknown): AppConfig {
    if (!isRecord(parsed)) {
      throw new Error('配置验证失败');
    }

    const mergedWithDefaults = mergeDefaults(
      structuredClone(DEFAULT_CONFIG) as Record<string, unknown>,
      parsed as Record<string, unknown>,
    ) as AppConfig;
    const validated = this.validateConfigObject(mergedWithDefaults);

    if (JSON.stringify(parsed) !== JSON.stringify(validated)) {
      logger.warn('配置存在缺失字段 —— 已用默认值修补');
    }

    return validated as AppConfig;
  }

  private validateConfigObject(value: unknown): AppConfig {
    const validated = Value.Default(AppConfigSchema, value);

    if (!Value.Check(AppConfigSchema, validated)) {
      throw new Error('配置验证失败');
    }

    return validated as AppConfig;
  }

  private ensureLoaded(): Conf<Record<string, unknown>> {
    if (!this.configPath || !this.configStore) {
      throw new Error('配置未加载');
    }
    return this.configStore;
  }

  private readValidatedConfigFromStore(): AppConfig {
    return this.validateConfigPayload(this.ensureLoaded().store);
  }

  private writeConfigToStore(config: AppConfig): void {
    this.ensureLoaded().store = structuredClone(config) as Record<string, unknown>;
  }

  private persistWithGuard(config: AppConfig): void {
    this.selfUpdating = true;
    try {
      this.writeConfigToStore(config);
      this.lastKnownConfig = structuredClone(config);
    } finally {
      setTimeout(() => {
        this.selfUpdating = false;
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

  private notifyListeners(oldConfig: AppConfig, newConfig: AppConfig): void {
    for (const entry of this.listeners) {
      try {
        let result: void | Promise<void> = undefined;
        if (entry.key) {
          // 特定键监听器
          const oldVal = oldConfig[entry.key];
          const newVal = newConfig[entry.key];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            result = (entry.listener as ConfigChangeListener<unknown>)(newVal, oldVal);
          }
        } else {
          // 全局监听器
          result = (entry.listener as ConfigChangeListener<AppConfig>)(newConfig, oldConfig);
        }

        if (isPromiseLike(result)) {
          result.catch((err: unknown) => {
            logger.error('异步配置变更监听器出错', err);
          });
        }
      } catch (err) {
        logger.error('配置变更监听器出错', err);
      }
    }
  }

}

function isPromiseLike(value: unknown): value is Promise<void> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { catch?: unknown }).catch === 'function'
  );
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
    const part = parts[i];
    if (i === parts.length - 1) {
      current[part] = value;
    } else {
      current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
  }

  return result;
}
