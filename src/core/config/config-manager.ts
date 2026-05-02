/**
 * ConfigManager — 加载、验证、热重载配置并在变更时通知。
 *
 * 关键行为：
 * - 从 JSON 文件加载配置；缺失时创建默认配置
 * - TypeBox 验证，缺失字段回退到默认值
 * - `subscribe(key)` / `subscribeAll()` 用于变更通知
 * - `update(partial)` 合并并持久化；设置 `selfUpdating` 守卫以防止
 *   `fs.watch` 导致的无限重载循环
 * - `registerDefaults` / `syncDefaults` 供子系统声明默认值
 */

import fs from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import type { DeepPartial, ConfigChangeListener, Unsubscribe } from '../types';
import { createScopedLogger } from '../logger';
import { AppError } from '../errors';
import { mergeDefaults } from '../utils';
import { AppConfigSchema } from './schema';
import type { AppConfig } from './schema';
import { DEFAULT_CONFIG } from './defaults';
import { ConfigWatcher } from './config-watcher';
import { DefaultConfigRegistry } from './default-config-registry';

const logger = createScopedLogger('config');

type ListenerEntry = {
  key?: keyof AppConfig;
  listener: ConfigChangeListener<unknown>;
};

export class ConfigManager {
  private config: AppConfig | null = null;
  private configPath: string | null = null;
  private listeners: ListenerEntry[] = [];
  private configWatcher = new ConfigWatcher();
  private defaultConfigRegistry = new DefaultConfigRegistry();

  // ─── 生命周期 ────────────────────────────────────────────────

  /**
   * 从给定路径加载配置。
   * 如果文件不存在，则使用默认值创建。
   */
  async load(configPath: string): Promise<void> {
    this.configPath = configPath;

    if (!fs.existsSync(configPath)) {
      logger.info('未找到配置文件，正在使用默认值创建', { path: configPath });
      this.config = structuredClone(DEFAULT_CONFIG);
      await this.persistConfig();
    } else {
      logger.info('正在加载配置', { path: configPath });
      const raw = fs.readFileSync(configPath, 'utf-8');
      this.config = this.parseAndValidate(raw);
    }
  }

  // ─── 读取 ──────────────────────────────────────────────────────

  /** 获取整个配置的只读快照 */
  getConfig(): Readonly<AppConfig> {
    if (!this.config) {
      throw new AppError('配置未加载', 'CONFIG_VALIDATION');
    }
    return this.config;
  }

  /** 获取特定配置节的只读快照 */
  get<K extends keyof AppConfig>(key: K): Readonly<AppConfig[K]> {
    if (!this.config) {
      throw new AppError('配置未加载', 'CONFIG_VALIDATION');
    }
    return this.config[key];
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
    if (!this.config || !this.configPath) {
      throw new AppError('配置未加载', 'CONFIG_VALIDATION');
    }

    const oldConfig = structuredClone(this.config);
    const mergeBase = structuredClone(this.config) as Record<string, unknown>;

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

    this.config = validatedConfig;

    // 写入磁盘前设置守卫
    this.configWatcher.setSelfUpdating(true);
    try {
      await this.persistConfig();
    } finally {
      // 短暂延迟后清除守卫，让 fs.watch 事件平息
      setTimeout(() => {
        this.configWatcher.setSelfUpdating(false);
      }, this.configWatcher.getDebounceMs() + 50);
    }

    this.notifyListeners(oldConfig);
  }

  // ─── 默认值 ──────────────────────────────────────────────────

  /**
   * 为子系统注册默认值。
   * 这些值通过 `syncDefaults()` 同步到配置中。
   */
  registerDefaults(key: string, defaults: Record<string, unknown>): void {
    this.defaultConfigRegistry.registerDefaults(key, defaults);
  }

  /**
   * 将所有已注册的默认值合并到当前配置并持久化。
   * 通常在启动结束时调用，此时所有子系统都已注册其默认值。
   */
  async syncDefaults(): Promise<void> {
    if (!this.config || !this.configPath) {
      throw new AppError('配置未加载', 'CONFIG_VALIDATION');
    }

    const oldConfig = structuredClone(this.config);
    const mergedConfig = this.defaultConfigRegistry.mergeInto(this.config);

    this.config = this.validateConfigObject(mergedConfig);

    this.configWatcher.setSelfUpdating(true);
    try {
      await this.persistConfig();
    } finally {
      setTimeout(() => {
        this.configWatcher.setSelfUpdating(false);
      }, this.configWatcher.getDebounceMs() + 50);
    }

    this.notifyListeners(oldConfig);
  }

  // ─── 热重载 ─────────────────────────────────────────────────

  /** 开始监视配置文件的外部变更 */
  startHotReload(): void {
    if (!this.configPath) {
      throw new AppError('配置未加载 —— 无法启动热重载', 'CONFIG_VALIDATION');
    }

    this.configWatcher.start(this.configPath, () => this.reloadFromFile());
  }

  /** 停止监视配置文件 */
  stopHotReload(): void {
    this.configWatcher.stop();
  }

  // ─── 私有辅助函数 ───────────────────────────────────────────

  private reloadFromFile(): void {
    if (!this.configPath) return;

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const newConfig = this.parseAndValidate(raw);

      // 比较规范化 JSON 以检测真实变更
      const oldNormalised = JSON.stringify(this.config);
      const newNormalised = JSON.stringify(newConfig);

      if (oldNormalised === newNormalised) {
        logger.debug('配置文件已变更但内容相同 —— 跳过');
        return;
      }

      const oldConfig = this.config;
      if (!oldConfig) {
        this.config = newConfig;
        logger.info('已从文件重新加载配置');
        return;
      }
      this.config = newConfig;
      this.notifyListeners(oldConfig);
      logger.info('已从文件重新加载配置');
    } catch (err) {
      logger.error('重新加载配置文件失败', err);
    }
  }

  private parseAndValidate(raw: string): AppConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new AppError('配置文件中的 JSON 无效', 'CONFIG_VALIDATION', err);
    }

    if (!isPlainObject(parsed)) {
      const errors = [...Value.Errors(AppConfigSchema, parsed)];
      throw new AppError('配置验证失败', 'CONFIG_VALIDATION', errors);
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
      const errors = [...Value.Errors(AppConfigSchema, validated)];
      throw new AppError('配置验证失败', 'CONFIG_VALIDATION', errors);
    }

    return validated as AppConfig;
  }

  private async persistConfig(): Promise<void> {
    if (!this.configPath) return;
    const json = JSON.stringify(this.config, null, 2);
    mkdirSync(dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, json, 'utf-8');
  }

  private notifyListeners(oldConfig: AppConfig): void {
    const newConfig = this.config;
    if (!newConfig) {
      return;
    }

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
