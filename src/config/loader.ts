import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from 'fs';
import { join, dirname } from 'path';
import YAML from 'yaml';
import type { Config } from '../types.js';
import { logger } from '../logger/index.js';

const DEFAULT_CONFIG: Config = {
  server: {
    host: '0.0.0.0',
    apiPort: 18792,
    apiEnabled: true
  },
  agent: {
    defaults: {
      model: 'gpt-4o',
      provider: 'openai',

      // 视觉和推理配置
      vision: false,
      reasoning: false,
      visionProvider: '',
      visionModel: '',

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
      apiKey: process.env.OPENAI_API_KEY ?? '',
      apiBase: 'https://api.openai.com/v1'
    },
    custom: {
      apiKey: '',
      apiBase: ''
    }
  },
  mcp: {},
  plugins: {},
  skills: {},
  log: {
    level: 'info'
  },
  metrics: {
    enabled: true,
    maxMetrics: 10000
  },
  tools: {
    blacklist: []
  }
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
    // Validate before saving
    const validation = this.validate(config);
    if (!validation.valid) {
      const errorMsg = `Configuration validation failed:\n${validation.errors.join('\n')}`;
      this.log.error(errorMsg);
      throw new Error(errorMsg);
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(warn => this.log.warn(warn));
    }

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

  static validate(config: Config): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.agent?.defaults?.provider) errors.push('agent.defaults.provider is required');
    if (!config.agent?.defaults?.model) errors.push('agent.defaults.model is required');

    const provider = config.agent?.defaults?.provider;
    if (provider && !config.providers?.[provider]) {
      errors.push(`LLM provider "${provider}" is not configured in providers section`);
    }
    if (provider && config.providers?.[provider]) {
      if (!config.providers[provider].apiKey && !process.env[`${provider.toUpperCase()}_API_KEY`]) {
        warnings.push(`Provider "${provider}" has no apiKey configured`);
      }
    }

    if (config.server?.apiPort && (config.server.apiPort < 1 || config.server.apiPort > 65535)) {
      errors.push(`Invalid server.apiPort: ${config.server.apiPort} (must be 1-65535)`);
    }

    const validContextModes = ['session', 'channel', 'global'];
    if (config.agent?.defaults?.contextMode && !validContextModes.includes(config.agent.defaults.contextMode)) {
      errors.push(`Invalid contextMode: ${config.agent.defaults.contextMode}`);
    }

    if (config.agent?.defaults?.maxToolIterations !== undefined) {
      if (config.agent.defaults.maxToolIterations < 0) errors.push('maxToolIterations must be >= 0');
      if (config.agent.defaults.maxToolIterations > 100) warnings.push('maxToolIterations > 100 may cause performance issues');
    }

    if (config.agent?.defaults?.memoryWindow !== undefined && config.agent.defaults.memoryWindow < 0) {
      errors.push('memoryWindow must be >= 0');
    }

    if (config.agent?.defaults?.maxSessions !== undefined && config.agent.defaults.maxSessions < 1) {
      errors.push('maxSessions must be >= 1');
    }

    if (config.channels) {
      for (const [name, ch] of Object.entries(config.channels)) {
        if (ch?.enabled && name === 'onebot' && !ch.wsUrl) {
          warnings.push(`Channel "${name}" is enabled but wsUrl is not configured`);
        }
      }
    }

    // Validate vision provider if specified
    if (config.agent?.defaults?.visionProvider) {
      const vp = config.agent.defaults.visionProvider;
      if (!config.providers?.[vp]) {
        errors.push(`Vision provider "${vp}" is not configured in providers section`);
      }
    }

    // Warn if reasoning is enabled but model may not support it
    if (config.agent?.defaults?.reasoning === true) {
      const model = config.agent.defaults.model;
      if (!model.startsWith('o') && !model.includes('reasoning')) {
        warnings.push(`Reasoning enabled but model "${model}" may not support reasoning mode`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  static async updatePluginConfig(name: string, enabled: boolean, options?: Record<string, any>): Promise<void> {
    const config = this.get();
    if (!config.plugins || typeof config.plugins !== 'object') {
      (config as any).plugins = {};
    }
    (config.plugins as any)[name] = { enabled, ...(options && { options }) };
    await this.save(config);
  }

  private static sanitizeForSave(config: Config): Config {
    if (!this.config || !this.config.providers) {
      return config;
    }

    const result = JSON.parse(JSON.stringify(config));
    
    for (const key of Object.keys(result.providers ?? {})) {
      if (result.providers[key]?.apiKey === '***') {
        result.providers[key].apiKey = this.config.providers[key]?.apiKey ?? '';
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
