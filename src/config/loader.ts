import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from 'fs';
import { join, dirname, basename } from 'path';
import { randomBytes } from 'crypto';
import type { Config } from '../types.js';
import { logger } from '../logger/index.js';
import { parse, stringify } from 'smol-toml';

const DEFAULT_CONFIG: Config = {
  server: {
    host: '0.0.0.0',
    apiPort: 18792,
    apiEnabled: true,
    token: ''
  },
  agent: {
    defaults: {
      model: 'gpt-4o',
      provider: 'openai',
      vision: false,
      reasoning: false,
      visionProvider: '',
      visionModel: '',
      maxToolIterations: 40,
      memoryWindow: 50,
      memorySummary: {
        enabled: false,
        provider: '',
        model: '',
        triggerMessages: 50
      },
      memoryFacts: {
        enabled: false,
        provider: '',
        model: '',
        maxFacts: 100
      },
      systemPrompt: 'You are a helpful AI assistant.',
      contextMode: 'channel',
      maxSessions: 100
    }
  },
  agents: {
    roles: {}
  },
  channels: {},
  providers: {
    openai: {
      apiKey: '',
      apiBase: 'https://api.openai.com/v1',
      model: 'gpt-4o'
    }
  },
  skills: {},
  tools: {
    blacklist: [],
    timeoutMs: 30000
  },
  log: {
    level: 'info'
  },
  metrics: {
    enabled: true,
    maxMetrics: 10000
  }
};

export class ConfigLoader {
  private static config: Config | null = null;
  private static configPath = join(process.cwd(), 'config.toml');
  private static watcher: fsWatcher | null = null;
  private static log = logger.child({ prefix: 'ConfigLoader' });
  private static reloadListeners = new Set<(config: Config) => void | Promise<void>>();

  static setPath(configPath: string): void {
    this.configPath = configPath;
  }

  static getPath(): string {
    return this.configPath;
  }

  static ensureDefaults(config: Config): Config {
    return this.merge(DEFAULT_CONFIG, config);
  }

  static async save(config: Config): Promise<void> {
    const withDefaults = this.ensureDefaults(config);
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.configPath, stringify(withDefaults), 'utf-8');
    this.config = withDefaults;
  }

  static async load(configPath?: string): Promise<Config> {
    if (configPath) {
      this.configPath = configPath;
    }

    if (this.config) {
      return this.config;
    }

    if (!existsSync(this.configPath)) {
      const nextConfig = this.ensureDefaults({ ...DEFAULT_CONFIG });
      if (!nextConfig.server.token) {
        nextConfig.server.token = randomBytes(24).toString('hex');
      }
      await this.save(nextConfig);
      this.config = nextConfig;
      this.startWatching();
      return nextConfig;
    }

    const raw = readFileSync(this.configPath, 'utf-8');
    const parsed = parse(raw) as unknown as Config;
    const merged = this.ensureDefaults(parsed);
    if (!merged.server.token) {
      merged.server.token = randomBytes(24).toString('hex');
      await this.save(merged);
    }
    this.config = merged;
    this.startWatching();
    return merged;
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

  static async updatePluginConfig(name: string, enabled: boolean, options?: Record<string, any>): Promise<void> {
    const config = this.get();
    config.plugins ||= {};
    config.plugins[name] = {
      ...(config.plugins[name] || {}),
      enabled,
      ...(options ? { options } : {})
    };
    await this.save(config);
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
          const raw = readFileSync(this.configPath, 'utf-8');
          const parsed = parse(raw) as unknown as Config;
          this.config = this.ensureDefaults(parsed);
          this.log.info('Config reloaded from disk');
          for (const listener of this.reloadListeners) {
            await listener(this.config);
          }
        } catch (error) {
          this.log.warn('Failed to reload config:', error);
        }
      });
      this.log.debug('Started file watcher');
    } catch (error) {
      this.log.warn('Failed to start file watcher:', error);
    }
  }

  static stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.log.debug('Stopped file watcher');
    }
  }

  private static merge(base: any, override: any): any {
    if (!override || Object.keys(override).length === 0) {
      return base;
    }

    if (!base || typeof base !== 'object') {
      return override;
    }

    const result: any = { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        result[key] = this.merge(base[key], value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}

type fsWatcher = ReturnType<typeof watch>;

export function getConfig(): Config {
  return ConfigLoader.get();
}
