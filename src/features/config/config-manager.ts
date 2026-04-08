import * as fs from 'fs';
import { ZodError } from 'zod';
import { FullConfigSchema, DEFAULT_CONFIG, type FullConfig } from './schema.js';
import { logger } from '../../platform/observability/logger.js';
import { pathResolver } from '../../platform/utils/paths.js';

interface ParsedConfig {
  providers?: Record<string, unknown>;
  mcp?: {
    servers?: unknown[];
  };
  channels?: Record<string, unknown>;
  [key: string]: unknown;
}



type ProviderExample = Record<string, {
  type: 'openai_chat' | 'openai_completion' | 'anthropic';
  api_key: string;
  base_url: string;
  models: Record<string, {
    modelname: string;
    contextWindow: number;
    reasoning: boolean;
  }>;
}>

interface MCPServerExample {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}


export class ConfigManager {
  private static instance: ConfigManager;
  private _config: FullConfig | null = null;
  private initialized: boolean = false;
  private configPath: string;
  private selfUpdating: boolean = false;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingPluginDefaults: Map<string, Record<string, unknown>> = new Map();
  private pendingChannelDefaults: Map<string, Record<string, unknown>> = new Map();

  get config(): FullConfig {
    if (!this._config) {
      throw new Error('ConfigManager not initialized');
    }
    return this._config;
  }

  private constructor() {
    this.configPath = pathResolver.getConfigFilePath();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.loadConfig();
      this.setupFileWatcher();
      this.initialized = true;
      logger.info({ configPath: this.configPath }, 'ConfigManager initialized with hot-reload');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize ConfigManager');
      throw error;
    }
  }

  private async loadConfig(): Promise<void> {
    if (!fs.existsSync(this.configPath)) {
      logger.info({ path: this.configPath }, 'Config file not found, generating default');
      await this.writeDefaultConfig();
      this._config = DEFAULT_CONFIG;
      return;
    }

    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8');
      const parsed = this.parseConfig(content);
      if (parsed) {
        const originalContent = content.trim();
        const newContent = this.serializeToJSON(parsed).trim();

        if (originalContent !== newContent) {
          logger.info({}, 'Config was incomplete, added missing fields with defaults');
          await this.saveMergedConfig(parsed);
          logger.info({ path: this.configPath }, 'Updated config file with default values');
        }

        this._config = parsed;
        logger.info({ path: this.configPath }, 'Config loaded successfully');
      } else {
        logger.warn({}, 'Config parse failed, using cached/default config');
      }
    } catch (error) {
      this.gracefulDegradation(error as Error);
    }
  }

  private async saveMergedConfig(config: FullConfig): Promise<void> {
    const jsonString = this.serializeToJSON(config);
    await fs.promises.writeFile(this.configPath, jsonString, 'utf-8');
  }

  private parseConfig(content: string): FullConfig | null {
    try {
      const parsed = JSON.parse(content);
      const result = FullConfigSchema.safeParse(parsed);

      if (result.success) {
        if (this.shouldAddDefault(parsed, config => config.providers, providers => !providers || Object.keys(providers).length === 0)) {
          result.data.providers = this.getDefaultProviderExample();
          logger.info({}, 'No providers configured, adding default provider example');
        }

        if (this.shouldAddDefault(parsed, config => config.mcp?.servers, servers => !servers || !Array.isArray(servers) || servers.length === 0)) {
          result.data.mcp = { servers: this.getDefaultMCPServerExample() };
          logger.info({}, 'No MCP servers configured, adding default MCP server example');
        }

        if (this.shouldAddDefault(parsed, config => config.channels, channels => !channels || Object.keys(channels).length === 0)) {
          result.data.channels = {};
          logger.info({}, 'No channels configured, channels will be loaded from plugins');
        }

        return result.data;
      }

      logger.warn({ issues: this.formatZodErrors(result.error) }, 'Zod validation failed, attempting to fill missing fields with defaults');

      const parsedConfig = parsed as ParsedConfig;
      const hasProviders = !this.shouldAddDefault(parsedConfig, config => config.providers, providers => !providers || Object.keys(providers).length === 0);
      const hasMCPServers = !this.shouldAddDefault(parsedConfig, config => config.mcp?.servers, servers => !servers || !Array.isArray(servers) || servers.length === 0);
      const hasChannels = !this.shouldAddDefault(parsedConfig, config => config.channels, channels => !channels || Object.keys(channels).length === 0);

      const mergedProviders = hasProviders ? parsedConfig.providers : this.getDefaultProviderExample();
      const mergedMCPServers = hasMCPServers ? parsedConfig.mcp?.servers : this.getDefaultMCPServerExample();
      const mergedChannels = hasChannels ? parsedConfig.channels : {};

      const merged = {
        ...DEFAULT_CONFIG,
        ...parsedConfig,
        providers: mergedProviders,
        mcp: { servers: mergedMCPServers },
        channels: mergedChannels,
      };

      const mergedResult = FullConfigSchema.safeParse(merged);

      if (mergedResult.success) {
        if (!hasProviders) {
          logger.info({}, 'No providers configured, adding default provider example');
        }
        if (!hasMCPServers) {
          logger.info({}, 'No MCP servers configured, adding default MCP server example');
        }
        if (!hasChannels) {
          logger.info({}, 'No channels configured, adding default channel example');
        }
        if (hasProviders || hasMCPServers || hasChannels) {
          logger.info({}, 'Successfully merged user config with defaults');
        }
        return mergedResult.data;
      }

      logger.warn({}, 'Partial config merge also failed, using full defaults');
      return DEFAULT_CONFIG;
    } catch (error) {
      logger.error({ error }, 'Config parse error, using defaults');
      return DEFAULT_CONFIG;
    }
  }

  private shouldAddDefault<T>(parsedConfig: ParsedConfig, getter: (config: ParsedConfig) => T | undefined, isEmpty: (value: T) => boolean): boolean {
    const value = getter(parsedConfig);
    return value === undefined || isEmpty(value);
  }

  private getDefaultProviderExample(): ProviderExample {
    return {
      openai: {
        type: 'openai_chat',
        api_key: 'your-api-key',
        base_url: 'https://api.openai.com/v1',
        models: {
          default: {
            modelname: 'gpt-4o',
            contextWindow: 128000,
            reasoning: false,
          },
        },
      },
    };
  }

  private getDefaultMCPServerExample(): MCPServerExample[] {
    return [
      {
        name: 'example',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', './skills'],
        enabled: false,
      },
    ];
  }

  private async writeDefaultConfig(): Promise<void> {
    const defaultConfig = {
      ...DEFAULT_CONFIG,
      channels: {},
    };
    const jsonString = this.serializeToJSON(defaultConfig);
    await fs.promises.writeFile(this.configPath, jsonString, 'utf-8');
    logger.info({ path: this.configPath }, 'Default config file generated');
  }

  private setupFileWatcher(): void {
    if (this.watcher) {
      return;
    }

    try {
      this.watcher = fs.watch(this.configPath, (eventType) => {
        if (eventType !== 'change') return;
        this.handleFileChange();
      });
      logger.info({}, 'File watcher setup successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to setup file watcher');
    }
  }

  private handleFileChange(): void {
    if (this.selfUpdating) {
      logger.debug({}, 'Ignoring self-triggered file change');
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      await this.reload();
    }, 500);
  }

  private async reload(): Promise<void> {
    logger.info({}, 'Reloading configuration...');
    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8');
      const parsed = this.parseConfig(content);
      if (parsed) {
        this._config = parsed;
        logger.info({}, 'Configuration reloaded successfully');
      } else {
        logger.warn({}, 'Config reload failed, keeping old config');
      }
    } catch (error) {
      this.gracefulDegradation(error as Error);
    }
  }

  private gracefulDegradation(error: Error): void {
    logger.error({ error }, 'Config system error, using cached config');
    if (!this._config) {
      this._config = DEFAULT_CONFIG;
      logger.info({}, 'Using default config as fallback');
    }
  }

  private formatZodErrors(error: ZodError): string {
    return error.issues.map((e) => `${e.path?.join('.') || 'unknown'}: ${e.message}`).join('; ');
  }

  getConfig(): FullConfig {
    return this.config;
  }

  async updateChannelConfig(
    channelName: string,
    config: Record<string, unknown>
  ): Promise<boolean> {
    if (!this._config) {
      logger.error({}, 'ConfigManager not initialized');
      return false;
    }

    try {
      const channels = this._config.channels || {};

      channels[channelName] = {
        ...channels[channelName],
        ...config,
      };

      return this.updateConfig({
        channels: channels,
      });
    } catch (error) {
      logger.error({ error, channelName }, 'Failed to update channel config');
      return false;
    }
  }

  registerPluginDefaults(name: string, defaults: Record<string, unknown>): void {
    this.pendingPluginDefaults.set(name, defaults);
  }

  registerChannelDefaults(name: string, defaults: Record<string, unknown>): void {
    this.pendingChannelDefaults.set(name, defaults);
  }

  async syncAllDefaultConfigs(): Promise<void> {
    if (!this._config) {
      logger.error({}, 'ConfigManager not initialized');
      return;
    }

    await this.syncPluginDefaults();
    await this.syncChannelDefaults();
  }

  private async syncPluginDefaults(): Promise<void> {
    if (!this._config || this.pendingPluginDefaults.size === 0) {
      return;
    }

    const plugins = this._config.plugins || [];

    for (const [name, defaults] of this.pendingPluginDefaults) {
      const existingConfig = plugins.find(p => {
        return p.name === name;
      });

      if (!existingConfig || !existingConfig.options || Object.keys(existingConfig.options).length === 0) {
        logger.info({ pluginName: name, defaults }, 'Adding plugin default options to config');
        await this.updatePluginConfig(name, true, defaults);
      }
    }
  }

  private async syncChannelDefaults(): Promise<void> {
    if (!this._config || this.pendingChannelDefaults.size === 0) {
      return;
    }

    const channels = this._config.channels || {};

    for (const [name, defaults] of this.pendingChannelDefaults) {
      const existingConfig = channels[name];

      if (!existingConfig || Object.keys(existingConfig).length === 0) {
        logger.info({ channelName: name, defaults }, 'Adding channel default options to config');
        await this.updateChannelConfig(name, defaults);
      }
    }
  }

  async updatePluginConfig(
    name: string,
    enabled: boolean,
    options?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this._config) {
      logger.error({}, 'ConfigManager not initialized');
      return false;
    }

    try {
      const plugins = this._config.plugins || [];

      const existingIndex = plugins.findIndex(p => {
        return p.name === name;
      });

      if (existingIndex >= 0) {
        plugins[existingIndex].enabled = enabled;
        if (options) {
          plugins[existingIndex].options = options;
        }
      } else {
        plugins.push({
          name: name,
          enabled,
          options: options || {},
        });
      }

      this._config.plugins = plugins;

      return this.updateConfig({
        plugins: plugins,
      });
    } catch (error) {
      logger.error({ error, name, enabled }, 'Failed to update plugin config');
      return false;
    }
  }

  async updateConfig(updates: Partial<FullConfig>): Promise<boolean> {
    if (!this._config) {
      logger.error({}, 'ConfigManager not initialized');
      return false;
    }

    try {
      const merged = this.mergeConfig(this._config, updates);
      const result = FullConfigSchema.safeParse(merged);
      if (!result.success) {
        logger.warn({ issues: this.formatZodErrors(result.error) }, 'Update validation failed');
        return false;
      }
      this._config = result.data;
      this.saveToDisk();
      return true;
    } catch (error) {
      logger.error({ error }, 'Update config failed');
      return false;
    }
  }

  private mergeConfig(current: FullConfig, updates: Partial<FullConfig>): FullConfig {
    const result = { ...current };
    
    if (updates.server) {
      result.server = { ...current.server, ...updates.server };
    }
    if (updates.providers) {
      result.providers = { ...current.providers, ...updates.providers };
    }
    if (updates.agent) {
      result.agent = { ...current.agent, ...updates.agent };
    }
    if (updates.memory) {
      result.memory = { ...current.memory, ...updates.memory };
    }
    if (updates.channels !== undefined) {
      result.channels = updates.channels ? { ...current.channels, ...updates.channels } : current.channels;
    }
    if (updates.mcp !== undefined) {
      result.mcp = updates.mcp ? { ...current.mcp, ...updates.mcp } : current.mcp;
    }
    if (updates.plugins !== undefined) {
      result.plugins = updates.plugins || current.plugins;
    }
    
    return result;
  }

  private saveToDisk(): void {
    if (!this._config) return;

    this.selfUpdating = true;
    try {
      const jsonString = this.serializeToJSON(this._config);
      fs.writeFileSync(this.configPath, jsonString, 'utf-8');
      logger.info({ path: this.configPath }, 'Configuration updated and saved to disk');
    } catch (error) {
      logger.error({ error }, 'Failed to save config to disk');
    } finally {
      setTimeout(() => {
        this.selfUpdating = false;
      }, 100);
    }
  }

  private serializeToJSON(config: FullConfig): string {
    return JSON.stringify(config, null, 2);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  destroy(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    logger.info({}, 'ConfigManager destroyed');
  }
}

export const configManager = ConfigManager.getInstance();
