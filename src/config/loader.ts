import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { basename, dirname, join } from 'path';
import type { Config } from '../types.js';
import { logger } from '../observability/index.js';
import { normalizeConfigError } from './errors.js';
import { parse, stringify } from 'smol-toml';
import { createDefaultConfig, parseConfig } from './schema.js';
import { providerReservedKeys } from './schema/providers.js';

type fsWatcher = ReturnType<typeof watch>;
type ConfigMutator = (config: Config) => void | Config | Promise<void | Config>;
type SerializableValue = string | number | boolean | null | SerializableValue[] | { [key: string]: SerializableValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripUndefined(value: unknown): SerializableValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value as string | boolean | null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item): item is SerializableValue => item !== undefined);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, SerializableValue> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalized = stripUndefined(nestedValue);
    if (normalized !== undefined) {
      result[key] = normalized;
    }
  }

  return result;
}

function cloneConfig(config: Config): Config {
  return structuredClone(config);
}

function withGeneratedToken(config: Config): Config {
  if (config.server.token) {
    return config;
  }

  const nextConfig = cloneConfig(config);
  nextConfig.server.token = randomBytes(24).toString('hex');
  return nextConfig;
}

export class ConfigLoader {
  private static readonly WATCH_DEBOUNCE_MS = 150;
  private static readonly WATCH_RETRY_MS = 200;
  private static readonly MAX_WATCH_RESTART_ATTEMPTS = 20;
  private static config: Config | null = null;
  private static configPath = join(process.cwd(), 'config.toml');
  private static watcher: fsWatcher | null = null;
  private static log = logger.child('ConfigLoader');
  private static reloadListeners = new Set<(previousConfig: Config | null, nextConfig: Config) => void | Promise<void>>();
  private static lastAppliedSignature: string | null = null;
  private static reloadTimer: NodeJS.Timeout | null = null;
  private static watcherRestartTimer: NodeJS.Timeout | null = null;

  private static ensureConfigDirectory(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private static applyConfigState(config: Config): Config {
    this.config = config;
    this.lastAppliedSignature = this.serializeConfig(config);
    return config;
  }

  private static clearReloadTimer(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  private static clearWatcherRestartTimer(): void {
    if (this.watcherRestartTimer) {
      clearTimeout(this.watcherRestartTimer);
      this.watcherRestartTimer = null;
    }
  }

  private static scheduleReload(): void {
    this.clearReloadTimer();
    this.reloadTimer = setTimeout(() => {
      this.clearReloadTimer();
      void this.reloadFromDisk();
    }, this.WATCH_DEBOUNCE_MS);
  }

  private static scheduleWatcherRestart(attemptsRemaining = this.MAX_WATCH_RESTART_ATTEMPTS): void {
    this.clearWatcherRestartTimer();
    if (attemptsRemaining <= 0 || this.watcher) {
      return;
    }

    this.watcherRestartTimer = setTimeout(() => {
      this.watcherRestartTimer = null;

      if (this.watcher) {
        return;
      }

      if (!existsSync(this.configPath)) {
        this.scheduleWatcherRestart(attemptsRemaining - 1);
        return;
      }

      this.startWatching();
      if (this.watcher) {
        this.scheduleReload();
      } else {
        this.scheduleWatcherRestart(attemptsRemaining - 1);
      }
    }, this.WATCH_RETRY_MS);
  }

  private static serializeConfig(config: Config): string {
    const serializable = stripUndefined(this.expandProviderModelTables(config)) ?? {};
    return stringify(serializable as Record<string, unknown>);
  }

  private static expandProviderModelTables(config: Config): Config {
    const next = structuredClone(config);

    for (const provider of Object.values(next.providers || {})) {
      const models = provider.models || {};

      delete (provider as { models?: unknown }).models;
      for (const [modelName, modelConfig] of Object.entries(models)) {
        (provider as Record<string, unknown>)[modelName] = modelConfig;
      }

      for (const key of providerReservedKeys) {
        if (key === 'models') {
          continue;
        }
        if ((provider as Record<string, unknown>)[key] === undefined) {
          delete (provider as Record<string, unknown>)[key];
        }
      }
    }

    return next;
  }

  private static persistConfig(config: Config): Config {
    this.ensureConfigDirectory();
    writeFileSync(this.configPath, this.serializeConfig(config), 'utf-8');
    return config;
  }

  private static restorePersistedConfig(config: Config | null): void {
    if (!config) {
      return;
    }

    this.ensureConfigDirectory();
    writeFileSync(this.configPath, this.serializeConfig(config), 'utf-8');
  }

  private static readParsedConfig(): Config {
    const raw = readFileSync(this.configPath, 'utf-8');
    return parseConfig(parse(raw) as unknown);
  }

  static setPath(configPath: string): void {
    if (this.configPath !== configPath) {
      this.stopWatching();
      this.config = null;
      this.lastAppliedSignature = null;
    }
    this.configPath = configPath;
  }

  static async save(config: unknown): Promise<void> {
    const previousConfig = this.config ? cloneConfig(this.config) : null;
    const nextConfig = withGeneratedToken(parseConfig(config));
    const nextSignature = this.serializeConfig(nextConfig);
    const previousSignature = this.lastAppliedSignature;
    this.lastAppliedSignature = nextSignature;
    this.persistConfig(nextConfig);
    try {
      await this.notifyReload(nextConfig);
    } catch (error) {
      this.lastAppliedSignature = previousSignature;
      this.restorePersistedConfig(previousConfig);
      throw error;
    }
  }

  static async update(mutator: ConfigMutator): Promise<Config> {
    const currentConfig = cloneConfig(await this.load());
    const updatedConfig = await mutator(currentConfig);
    const nextConfig = withGeneratedToken(parseConfig(updatedConfig ?? currentConfig));
    const previousConfig = this.config ? cloneConfig(this.config) : null;
    const previousSignature = this.lastAppliedSignature;
    this.lastAppliedSignature = this.serializeConfig(nextConfig);
    const savedConfig = this.persistConfig(nextConfig);
    try {
      await this.notifyReload(savedConfig);
    } catch (error) {
      this.lastAppliedSignature = previousSignature;
      this.restorePersistedConfig(previousConfig);
      throw error;
    }
    return savedConfig;
  }

  static async load(configPath?: string): Promise<Config> {
    if (configPath) {
      this.setPath(configPath);
    }

    if (this.config) {
      return this.config;
    }

    if (!existsSync(this.configPath)) {
      const nextConfig = withGeneratedToken(createDefaultConfig());
      this.persistConfig(nextConfig);
      this.applyConfigState(nextConfig);
      this.startWatching();
      return nextConfig;
    }

    const loadedConfig = this.readParsedConfig();
    if (!loadedConfig.server.token) {
      const nextConfig = withGeneratedToken(loadedConfig);
      this.persistConfig(nextConfig);
      this.applyConfigState(nextConfig);
    } else {
      this.applyConfigState(loadedConfig);
    }

    this.startWatching();
    return this.get();
  }

  static get(): Config {
    if (!this.config) {
      throw new Error('Config not loaded');
    }

    return this.config;
  }

  static onReload(listener: (previousConfig: Config | null, nextConfig: Config) => void | Promise<void>): () => void {
    this.reloadListeners.add(listener);
    return () => {
      this.reloadListeners.delete(listener);
    };
  }

  private static async notifyReload(config: Config): Promise<void> {
    const previousConfig = this.config ? cloneConfig(this.config) : null;
    for (const listener of this.reloadListeners) {
      await listener(previousConfig, config);
    }
    this.applyConfigState(config);
  }

  static async updatePluginConfig(name: string, enabled: boolean, options?: Record<string, any>): Promise<Config> {
    return this.update((config) => {
      config.plugins[name] = {
        ...(config.plugins[name] || {}),
        enabled,
        ...(options ? { options } : {})
      };
    });
  }

  static startWatching(): void {
    if (this.watcher) {
      return;
    }

    try {
      this.watcher = watch(this.configPath, (eventType, filename) => {
        if (!filename || basename(filename.toString()) !== basename(this.configPath)) {
          return;
        }

        if (eventType === 'rename') {
          this.stopWatching();
          this.scheduleWatcherRestart();
          this.scheduleReload();
          return;
        }

        if (eventType !== 'change') {
          return;
        }

        this.scheduleReload();
      });
      this.log.debug('已启动文件监视器');
    } catch (error) {
      this.log.warn('启动配置文件监视器失败', {
        error: normalizeConfigError(error)
      });
    }
  }

  static stopWatching(): void {
    this.clearReloadTimer();
    this.clearWatcherRestartTimer();

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.log.debug('已停止文件监视器');
    }
  }

  private static async reloadFromDisk(): Promise<void> {
    try {
      const parsedConfig = this.readParsedConfig();
      const nextConfig = parsedConfig.server.token ? parsedConfig : withGeneratedToken(parsedConfig);
      const signature = this.serializeConfig(nextConfig);

      if (signature === this.lastAppliedSignature) {
        this.log.debug('跳过冗余的配置重载通知');
        return;
      }

      this.log.info('配置已从磁盘重新加载');
      await this.notifyReload(nextConfig);

      if (nextConfig !== parsedConfig) {
        this.persistConfig(nextConfig);
      }
    } catch (error) {
      this.log.warn('重新加载配置失败', {
        error: normalizeConfigError(error)
      });
    }
  }
}

export function getConfig(): Config {
  return ConfigLoader.get();
}

export { configSchema, DEFAULT_CONFIG, createDefaultConfig, parseConfig } from './schema.js';
export type { ConfigMutator };
