import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import type { Config } from '../types.js';
import { logger } from '../observability/index.js';
import { normalizeConfigInput } from './configNormalizer.js';
import { serializeConfig } from './configSerializer.js';
import { ConfigWatcher } from './configWatcher.js';
import { normalizeConfigError } from './errors.js';
import { parse } from 'smol-toml';
import { createDefaultConfig, parseConfig } from './schema.js';

type ConfigMutator = (config: Config) => void | Config | Promise<void | Config>;

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
  private static log = logger.child('ConfigLoader');
  private static reloadListeners = new Set<(previousConfig: Config | null, nextConfig: Config) => void | Promise<void>>();
  private static lastAppliedSignature: string | null = null;
  private static watcher = new ConfigWatcher({
    getConfigPath: () => this.configPath,
    log: this.log,
    onReloadRequested: () => {
      void this.reloadFromDisk();
    },
    watchDebounceMs: this.WATCH_DEBOUNCE_MS,
    watchRetryMs: this.WATCH_RETRY_MS,
    maxWatchRestartAttempts: this.MAX_WATCH_RESTART_ATTEMPTS
  });

  private static ensureConfigDirectory(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private static applyConfigState(config: Config): Config {
    this.config = config;
    this.lastAppliedSignature = serializeConfig(config);
    return config;
  }

  private static persistConfig(config: Config): Config {
    this.ensureConfigDirectory();
    writeFileSync(this.configPath, serializeConfig(config), 'utf-8');
    return config;
  }

  private static restorePersistedConfig(config: Config | null): void {
    if (!config) {
      return;
    }

    this.ensureConfigDirectory();
    writeFileSync(this.configPath, serializeConfig(config), 'utf-8');
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
    const nextConfig = withGeneratedToken(parseConfig(normalizeConfigInput(config)));
    const nextSignature = serializeConfig(nextConfig);
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
    const nextConfig = withGeneratedToken(parseConfig(normalizeConfigInput(updatedConfig ?? currentConfig)));
    const previousConfig = this.config ? cloneConfig(this.config) : null;
    const previousSignature = this.lastAppliedSignature;
    this.lastAppliedSignature = serializeConfig(nextConfig);
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
    this.watcher.start();
  }

  static stopWatching(): void {
    this.watcher.stop();
  }

  private static async reloadFromDisk(): Promise<void> {
    try {
      const parsedConfig = this.readParsedConfig();
      const nextConfig = parsedConfig.server.token ? parsedConfig : withGeneratedToken(parsedConfig);
      const signature = serializeConfig(nextConfig);

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
