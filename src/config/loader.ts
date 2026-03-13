import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { basename, dirname, join } from 'path';
import type { Config } from '../types.js';
import { logger } from '../observability/index.js';
import { normalizeError } from '../errors/index.js';
import { parse, stringify } from 'smol-toml';
import { createDefaultConfig, parseConfig, configSchema } from './schema.js';

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
  private static config: Config | null = null;
  private static configPath = join(process.cwd(), 'config.toml');
  private static watcher: fsWatcher | null = null;
  private static log = logger.child('ConfigLoader');
  private static reloadListeners = new Set<(config: Config) => void | Promise<void>>();

  private static ensureConfigDirectory(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private static serializeConfig(config: Config): string {
    const serializable = stripUndefined(config) ?? {};
    return stringify(serializable as Record<string, unknown>);
  }

  private static writeConfig(config: Config): void {
    this.ensureConfigDirectory();
    const nextConfig = withGeneratedToken(config);
    writeFileSync(this.configPath, this.serializeConfig(nextConfig), 'utf-8');
    this.config = nextConfig;
  }

  private static readParsedConfig(): Config {
    const raw = readFileSync(this.configPath, 'utf-8');
    return parseConfig(parse(raw) as unknown);
  }

  static setPath(configPath: string): void {
    this.configPath = configPath;
  }

  static getPath(): string {
    return this.configPath;
  }

  static async save(config: unknown): Promise<void> {
    this.writeConfig(parseConfig(config));
  }

  static async update(mutator: ConfigMutator): Promise<Config> {
    const currentConfig = cloneConfig(await this.load());
    const updatedConfig = await mutator(currentConfig);
    const nextConfig = parseConfig(updatedConfig ?? currentConfig);
    this.writeConfig(nextConfig);
    return nextConfig;
  }

  static async load(configPath?: string): Promise<Config> {
    if (configPath) {
      this.configPath = configPath;
    }

    if (this.config) {
      return this.config;
    }

    if (!existsSync(this.configPath)) {
      const nextConfig = withGeneratedToken(createDefaultConfig());
      this.writeConfig(nextConfig);
      this.startWatching();
      return nextConfig;
    }

    const loadedConfig = this.readParsedConfig();
    if (!loadedConfig.server.token) {
      this.writeConfig(loadedConfig);
    } else {
      this.config = loadedConfig;
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

  static onReload(listener: (config: Config) => void | Promise<void>): () => void {
    this.reloadListeners.add(listener);
    return () => {
      this.reloadListeners.delete(listener);
    };
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
      this.watcher = watch(this.configPath, async (eventType, filename) => {
        if (!filename || basename(filename.toString()) !== basename(this.configPath)) {
          return;
        }

        if (eventType !== 'change') {
          return;
        }

        try {
          this.config = this.readParsedConfig();
          this.log.info('Config reloaded from disk');
          for (const listener of this.reloadListeners) {
            await listener(this.get());
          }
        } catch (error) {
          this.log.warn('Failed to reload config', {
            error: normalizeError(error)
          });
        }
      });
      this.log.debug('Started file watcher');
    } catch (error) {
      this.log.warn('Failed to start file watcher', {
        error: normalizeError(error)
      });
    }
  }

  static stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.log.debug('Stopped file watcher');
    }
  }
}

export function getConfig(): Config {
  return ConfigLoader.get();
}

export { configSchema, DEFAULT_CONFIG, createDefaultConfig, parseConfig } from './schema.js';
export type { ConfigMutator };
