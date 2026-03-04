import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import type { Config } from '../types.js';
import { logger } from '../logger/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_CONFIG: Config = {
  server: {
    host: '0.0.0.0',
    port: 18791,
    apiPort: 18792,
    webuiPort: 5173
  },
  agent: {
    defaults: {
      model: 'gpt-4o',
      provider: 'openai',
      maxTokens: 8192,
      temperature: 0.7,
      maxToolIterations: 40,
      memoryWindow: 50,
      systemPrompt: 'You are a helpful AI assistant.',
      contextMode: 'channel',
      maxSessions: 100
    }
  },
  channels: {
    onebot: {
      enabled: false,
      wsUrl: 'ws://127.0.0.1:6700/ws',
      httpUrl: 'http://127.0.0.1:5700',
      token: '',
      allowFrom: [],
      groupAllowFrom: []
    }
  },
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      apiBase: 'https://api.openai.com/v1'
    },
    custom: {
      apiKey: '',
      apiBase: ''
    }
  },
  mcp: {},
  plugins: {}
};

export class ConfigLoader {
  private static configPath = join(process.cwd(), 'config.yaml');
  private static config: Config | null = null;
  private static watcher: fsWatcher | null = null;
  private static reloadCallbacks: Array<(config: Config) => void | Promise<void>> = [];
  private static reloadDebounceTimer: NodeJS.Timeout | null = null;
  private static log = logger.child({ prefix: 'Config' });

  static async load(configPath?: string): Promise<Config> {
    if (this.config) {
      return this.config!;
    }

    const path = configPath || this.configPath;
    this.configPath = path;

    this.config = this.loadFromPath(path);
    
    this.startWatching();
    
    return this.config || DEFAULT_CONFIG;
  }

  private static loadFromPath(path: string): Config {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        const userConfig = YAML.parse(content);
        return this.merge(DEFAULT_CONFIG, userConfig);
      } catch (error) {
        this.log.error(`Failed to load config from ${path}:`, error);
        return DEFAULT_CONFIG;
      }
    } else {
      this.log.info('No config file found, using defaults');
      return DEFAULT_CONFIG;
    }
  }

  private static startWatching(): void {
    if (this.watcher) {
      return;
    }

    this.log.debug(`Starting file watcher: ${this.configPath}`);
    
    let lastMtime = 0;
    
    this.watcher = watch(this.configPath, (eventType) => {
      if (eventType === 'change') {
        if (this.reloadDebounceTimer) {
          clearTimeout(this.reloadDebounceTimer);
        }
        
        this.reloadDebounceTimer = setTimeout(async () => {
          this.log.info('Config file changed, reloading...');
          await this.reload();
        }, 500);
      }
    });
  }

  static async reload(): Promise<Config> {
    const newConfig = this.loadFromPath(this.configPath);
    const oldConfig = this.config;
    this.config = newConfig;
    
    this.log.info('Config reloaded');
    if (oldConfig) {
      this.log.debug(`Provider changed: ${oldConfig.agent.defaults.provider} -> ${newConfig.agent.defaults.provider}`);
      this.log.debug(`Model changed: ${oldConfig.agent.defaults.model} -> ${newConfig.agent.defaults.model}`);
    }
    
    for (const callback of this.reloadCallbacks) {
      try {
        await callback(newConfig);
      } catch (error) {
        this.log.error('Reload callback error:', error);
      }
    }
    
    return newConfig;
  }

  static onReload(callback: (config: Config) => void | Promise<void>): void {
    this.reloadCallbacks.push(callback);
  }

  static get(): Config {
    return this.config || DEFAULT_CONFIG;
  }

  static set(config: Config): void {
    this.config = config;
  }

  static async save(config: Config): Promise<void> {
    const path = this.configPath;
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const yaml = YAML.stringify(config);
    writeFileSync(path, yaml, 'utf-8');
    this.config = config;
  }

  static stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.log.debug('Stopped file watcher');
    }
  }

  private static merge(base: any, override: any): any {
    const result = { ...base };
    for (const key of Object.keys(override)) {
      if (typeof override[key] === 'object' && !Array.isArray(override[key]) && override[key] !== null) {
        result[key] = this.merge(base[key] || {}, override[key]);
      } else if (Array.isArray(override[key])) {
        result[key] = override[key];
      } else {
        result[key] = override[key];
      }
    }
    return result;
  }
}

type fsWatcher = ReturnType<typeof watch>;

export function getConfig(): Config {
  return ConfigLoader.get();
}
