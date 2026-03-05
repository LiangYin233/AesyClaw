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
      friendAllowFrom: [],
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
  private static pluginDefaultConfigs: Record<string, any> = {};

  static async loadPluginDefaultConfigs(): Promise<Record<string, any>> {
    if (Object.keys(this.pluginDefaultConfigs).length > 0) {
      return this.pluginDefaultConfigs;
    }

    const pluginsDir = join(process.cwd(), 'plugins');
    if (!existsSync(pluginsDir)) {
      return {};
    }

    try {
      const entries = await import('fs/promises');
      const dirs = await entries.readdir(pluginsDir, { withFileTypes: true });
      
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        
        const mainPath = join(pluginsDir, dir.name, 'main.js');
        if (!existsSync(mainPath)) continue;

        try {
          const module = await import(`file://${mainPath}`);
          const plugin = module.default || module;
          
          if (plugin.defaultConfig) {
            this.pluginDefaultConfigs[dir.name] = {
              enabled: false,
              ...plugin.defaultConfig
            };
            this.log.debug(`Loaded default config for plugin: ${dir.name}`);
          } else {
            this.pluginDefaultConfigs[dir.name] = {
              enabled: false
            };
          }
        } catch (err) {
          this.log.warn(`Failed to load plugin default config: ${dir.name}`, err);
        }
      }
    } catch (err) {
      this.log.warn('Failed to scan plugins directory', err);
    }

    return this.pluginDefaultConfigs;
  }

  static async load(configPath?: string): Promise<Config> {
    if (this.config) {
      return this.config!;
    }

    const path = configPath || this.configPath;
    this.configPath = path;

    this.config = await this.loadFromPath(path);
    
    this.startWatching();
    
    return this.config || DEFAULT_CONFIG;
  }

  private static async loadFromPath(path: string): Promise<Config> {
    const pluginDefaults = await this.loadPluginDefaultConfigs();
    const baseConfig = { ...DEFAULT_CONFIG, plugins: pluginDefaults };

    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        const userConfig = YAML.parse(content);
        
        if (userConfig?.providers) {
          baseConfig.providers = userConfig.providers;
        }
        
        return this.merge(baseConfig, userConfig);
      } catch (error) {
        this.log.error(`Failed to load config from ${path}:`, error);
        return baseConfig;
      }
    } else {
      this.log.info('No config file found, using defaults');
      return baseConfig;
    }
  }

  private static startWatching(): void {
    if (this.watcher) {
      return;
    }

    this.log.debug(`Starting file watcher: ${this.configPath}`);
    
    let ignoreUntil = Date.now() + 2000;
    
    this.watcher = watch(this.configPath, (eventType, filename) => {
      if (eventType === 'change' || eventType === 'rename') {
        if (Date.now() < ignoreUntil) {
          this.log.debug('Ignoring file change during startup');
          return;
        }
        
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
    const newConfig = await this.loadFromPath(this.configPath);
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

    const configToSave = this.sanitizeForSave(config);
    const yaml = YAML.stringify(configToSave);
    writeFileSync(path, yaml, 'utf-8');
    this.config = config;
  }

  private static sanitizeForSave(config: Config): Config {
    if (!this.config || !this.config.providers) {
      return config;
    }

    const result = JSON.parse(JSON.stringify(config));
    
    for (const key of Object.keys(result.providers || {})) {
      if (result.providers[key]?.apiKey === '***') {
        result.providers[key].apiKey = this.config.providers[key]?.apiKey || '';
      }
    }

    return result;
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
    
    for (const key of Object.keys(override)) {
      if (typeof override[key] === 'object' && !Array.isArray(override[key]) && override[key] !== null) {
        result[key] = this.merge(base[key], override[key]);
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
