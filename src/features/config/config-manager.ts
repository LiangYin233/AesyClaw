import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ZodError } from 'zod';
import * as smolToml from 'smol-toml';
import { FullConfigSchema, DEFAULT_CONFIG, type FullConfig, type ModelConfig } from './schema.js';
import { logger } from '../../platform/observability/logger.js';
import { pathResolver } from '../../platform/utils/paths.js';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: FullConfig | null = null;
  private initialized: boolean = false;
  private configPath: string;
  private selfUpdating: boolean = false;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

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
      this.config = DEFAULT_CONFIG;
      return;
    }

    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8');
      const parsed = this.parseConfig(content);
      if (parsed) {
        const originalContent = content.trim();
        const newContent = this.serializeToTOML(parsed).trim();

        if (originalContent !== newContent) {
          logger.info({}, 'Config was incomplete, added missing fields with defaults');
          await this.saveMergedConfig(parsed);
          logger.info({ path: this.configPath }, 'Updated config file with default values');
        }

        this.config = parsed;
        logger.info({ path: this.configPath }, 'Config loaded successfully');
      } else {
        logger.warn({}, 'Config parse failed, using cached/default config');
      }
    } catch (error) {
      this.gracefulDegradation(error as Error);
    }
  }

  private async saveMergedConfig(config: FullConfig): Promise<void> {
    const tomlString = this.serializeToTOML(config);
    await fs.promises.writeFile(this.configPath, tomlString, 'utf-8');
  }

  private parseConfig(content: string): FullConfig | null {
    try {
      const parsed = smolToml.parse(content);
      const result = FullConfigSchema.safeParse(parsed);

      if (result.success) {
        if (this.shouldAddDefaultProviders(parsed)) {
          result.data.providers = this.getDefaultProviderExample();
          logger.info({}, 'No providers configured, adding default provider example');
        }

        if (this.shouldAddDefaultMCPServers(parsed)) {
          result.data.mcp = { servers: this.getDefaultMCPServerExample() };
          logger.info({}, 'No MCP servers configured, adding default MCP server example');
        }

        if (this.shouldAddDefaultChannels(parsed)) {
          result.data.channels = this.getDefaultChannelExample();
          logger.info({}, 'No channels configured, adding default channel example');
        }

        return result.data;
      }

      logger.warn({ issues: this.formatZodErrors(result.error) }, 'Zod validation failed, attempting to fill missing fields with defaults');

      const parsedAny = parsed as any;
      const hasProviders = parsedAny?.providers && Object.keys(parsedAny.providers).length > 0;
      const hasMCPServers = parsedAny?.mcp?.servers && Array.isArray(parsedAny.mcp.servers) && parsedAny.mcp.servers.length > 0;

      const mergedProviders = hasProviders ? parsedAny.providers : this.getDefaultProviderExample();
      const mergedMCPServers = hasMCPServers ? parsedAny.mcp.servers : this.getDefaultMCPServerExample();
      const mergedChannels = this.shouldAddDefaultChannels(parsedAny) ? this.getDefaultChannelExample() : parsedAny.channels;

      const merged = {
        ...DEFAULT_CONFIG,
        ...parsedAny,
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
        if (this.shouldAddDefaultChannels(parsedAny)) {
          logger.info({}, 'No channels configured, adding default channel example');
        }
        if (hasProviders || hasMCPServers || !this.shouldAddDefaultChannels(parsedAny)) {
          logger.info({}, 'Successfully merged user config with defaults');
        }
        return mergedResult.data;
      }

      logger.warn({}, 'Partial config merge also failed, using full defaults');
      return DEFAULT_CONFIG;
    } catch (error) {
      logger.error({ error }, 'TOML parse error, using defaults');
      return DEFAULT_CONFIG;
    }
  }

  private deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const output = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        const sourceValue = source[key];
        const targetValue = target[key];

        if (sourceValue !== undefined && sourceValue !== null) {
          if (this.isPlainObject(sourceValue) && this.isPlainObject(targetValue)) {
            output[key] = this.deepMerge(targetValue, sourceValue);
          } else if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
            output[key] = [...targetValue, ...sourceValue];
          } else {
            output[key] = sourceValue;
          }
        }
      }
    }

    return output;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
  }

  private shouldAddDefaultProviders(parsedConfig: any): boolean {
    const hasProviders = parsedConfig?.providers && Object.keys(parsedConfig.providers).length > 0;
    return !hasProviders;
  }

  private shouldAddDefaultMCPServers(parsedConfig: any): boolean {
    const hasMCPServers = parsedConfig?.mcp?.servers && parsedConfig.mcp.servers.length > 0;
    return !hasMCPServers;
  }

  private getDefaultProviderExample(): Record<string, any> {
    return {
      openai: {
        type: 'openai_chat',
        api_key: 'your-api-key',
        base_url: 'https://api.openai.com/v1',
        models: {
          default: {
            modelname: 'gpt-4o',
            maxToken: 4096,
            reasoning: false,
            vision: false,
          },
        },
      },
    };
  }

  private getDefaultMCPServerExample(): any[] {
    return [
      {
        name: 'example',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', './skills'],
        enabled: false,
      },
    ];
  }

  private shouldAddDefaultChannels(parsedConfig: any): boolean {
    const hasChannels = parsedConfig?.channels && Object.keys(parsedConfig.channels).length > 0;
    return !hasChannels;
  }

  private getDefaultChannelExample(): Record<string, any> {
    return {
      onebot: {
        enabled: false,
        ws_url: 'ws://127.0.0.1:3001',
        access_token: '',
        group_ids: [],
        private_ids: [],
      },
    };
  }

  private async writeDefaultConfig(): Promise<void> {
    const defaultConfig = {
      ...DEFAULT_CONFIG,
      channels: this.getDefaultChannelExample(),
    };
    const tomlString = this.serializeToTOML(defaultConfig);
    await fs.promises.writeFile(this.configPath, tomlString, 'utf-8');
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
        this.config = parsed;
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
    if (!this.config) {
      this.config = DEFAULT_CONFIG;
      logger.info({}, 'Using default config as fallback');
    }
  }

  private formatZodErrors(error: ZodError): string {
    return error.issues.map((e: any) => `${e.path?.join('.') || 'unknown'}: ${e.message}`).join('; ');
  }

  getConfig(): FullConfig {
    if (!this.config) {
      throw new Error('ConfigManager not initialized. Call initialize() first.');
    }
    return this.config;
  }

  getServerConfig() {
    return this.getConfig().server;
  }

  getProvidersConfig() {
    return this.getConfig().providers;
  }

  getChannelsConfig() {
    return this.getConfig().channels;
  }

  getAgentConfig() {
    return this.getConfig().agent;
  }

  getMemoryConfig() {
    return this.getConfig().memory;
  }

  getMCPConfig() {
    return this.getConfig().mcp;
  }

  getPluginsConfig() {
    return this.getConfig().plugins;
  }

  async updatePluginConfig(name: string, enabled: boolean): Promise<boolean> {
    if (!this.config) {
      logger.error({}, 'ConfigManager not initialized');
      return false;
    }

    try {
      const plugins = this.config.plugins?.plugins || [];

      const normalizedName = name.replace('@aesyclaw/plugin-', '').replace('plugin-', '');

      const existingIndex = plugins.findIndex(p => {
        const configName = p.name.replace('@aesyclaw/plugin-', '').replace('plugin-', '');
        return configName === normalizedName || p.name === normalizedName;
      });

      if (existingIndex >= 0) {
        plugins[existingIndex].enabled = enabled;
      } else {
        plugins.push({
          name: normalizedName,
          enabled,
          options: {},
        });
      }

      return this.updateConfig({
        plugins: { plugins },
      });
    } catch (error) {
      logger.error({ error, name, enabled }, 'Failed to update plugin config');
      return false;
    }
  }

  getProviderCredential(provider: string) {
    const providers = this.getConfig().providers;
    return (providers as any)[provider] || null;
  }

  async reloadConfig(): Promise<void> {
    await this.reload();
  }

  async updateConfig(updates: Partial<FullConfig>): Promise<boolean> {
    if (!this.config) {
      logger.error({}, 'ConfigManager not initialized');
      return false;
    }

    try {
      const merged = this.mergeConfig(this.config, updates);
      const result = FullConfigSchema.safeParse(merged);
      if (!result.success) {
        logger.warn({ issues: this.formatZodErrors(result.error) }, 'Update validation failed');
        return false;
      }
      this.config = result.data;
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
      result.plugins = updates.plugins ? { ...current.plugins, ...updates.plugins } : current.plugins;
    }
    
    return result;
  }

  private saveToDisk(): void {
    if (!this.config) return;

    this.selfUpdating = true;
    try {
      const tomlString = this.serializeToTOML(this.config);
      fs.writeFileSync(this.configPath, tomlString, 'utf-8');
      logger.info({ path: this.configPath }, 'Configuration updated and saved to disk');
    } catch (error) {
      logger.error({ error }, 'Failed to save config to disk');
    } finally {
      setTimeout(() => {
        this.selfUpdating = false;
      }, 100);
    }
  }

  private serializeToTOML(config: FullConfig): string {
    const lines: string[] = [
      '# AesyClaw Configuration File',
      '# Auto-generated defaults for missing values',
      '',
    ];

    lines.push('[server]');
    lines.push(`port = ${config.server.port}`);
    lines.push(`host = "${config.server.host}"`);
    lines.push(`log_level = "${config.server.logLevel}"`);
    lines.push(`admin_token = "${config.server.adminToken}"`);
    lines.push('');

    const providerEntries = Object.entries(config.providers || {});
    if (providerEntries.length > 0) {
      lines.push('[providers]');
      for (const [name, provider] of providerEntries) {
        if (provider) {
          lines.push(`[providers.${name}]`);
          lines.push(`type = "${provider.type}"`);
          if (provider.api_key) lines.push(`api_key = "${provider.api_key}"`);
          if (provider.base_url) lines.push(`base_url = "${provider.base_url}"`);

          if (provider.models && Object.keys(provider.models).length > 0) {
            for (const [modelName, modelConfig] of Object.entries(provider.models)) {
              lines.push(`[providers.${name}.models.${modelName}]`);
              lines.push(`modelname = "${modelConfig.modelname}"`);
              lines.push(`maxToken = ${modelConfig.maxToken}`);
              lines.push(`reasoning = ${modelConfig.reasoning}`);
              lines.push(`vision = ${modelConfig.vision}`);
            }
          }
          lines.push('');
        }
      }
    }

    if (config.channels && Object.keys(config.channels).length > 0) {
      for (const [channelName, channelConfig] of Object.entries(config.channels)) {
        if (channelConfig && typeof channelConfig === 'object') {
          lines.push(`[channels.${channelName}]`);
          const fieldComments: Record<string, string> = {
            enabled: 'Enable this channel',
            ws_url: 'WebSocket server URL',
            access_token: 'Access token for authentication',
            group_ids: 'List of group IDs to listen',
            private_ids: 'List of private chat IDs to listen',
          };
          for (const [key, value] of Object.entries(channelConfig)) {
            if (value !== undefined && value !== null) {
              const comment = fieldComments[key];
              if (comment) {
                lines.push(`# ${comment}`);
              }
              if (typeof value === 'boolean') {
                lines.push(`${key} = ${value}`);
              } else if (typeof value === 'number') {
                lines.push(`${key} = ${value}`);
              } else if (typeof value === 'string') {
                lines.push(`${key} = "${value}"`);
              } else if (Array.isArray(value)) {
                lines.push(`${key} = ${JSON.stringify(value)}`);
              } else if (typeof value === 'object') {
                lines.push(`${key} = ${JSON.stringify(value)}`);
              }
            }
          }
          lines.push('');
        }
      }
    }

    lines.push('[agent]');
    lines.push(`max_turns = ${config.agent.max_turns}`);
    lines.push('');

    lines.push('[memory]');
    lines.push(`max_context_tokens = ${config.memory.max_context_tokens}`);
    lines.push(`compression_threshold = ${config.memory.compression_threshold}`);
    lines.push(`danger_threshold = ${config.memory.danger_threshold}`);
    lines.push('');

    if (config.mcp?.servers && config.mcp.servers.length > 0) {
      for (const server of config.mcp.servers) {
        lines.push('[[mcp.servers]]');
        lines.push(`name = "${server.name}"`);
        lines.push(`command = "${server.command}"`);
        if (server.args && server.args.length > 0) {
          lines.push(`args = ${JSON.stringify(server.args)}`);
        }
        if (server.env) {
          const envEntries = Object.entries(server.env).map(([k, v]) => `${k} = "${v}"`).join(', ');
          lines.push(`env = { ${envEntries} }`);
        }
        lines.push(`enabled = ${server.enabled}`);
        lines.push('');
      }
    }

    if (config.plugins?.plugins && config.plugins.plugins.length > 0) {
      lines.push('[plugins]');
      lines.push('plugins = [');
      for (const plugin of config.plugins.plugins) {
        lines.push('  {');
        lines.push(`    name = "${plugin.name}"`);
        lines.push(`    enabled = ${plugin.enabled}`);
        if (plugin.options) {
          const optionsEntries = Object.entries(plugin.options).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ');
          lines.push(`    options = { ${optionsEntries} }`);
        }
        lines.push('  },');
      }
      lines.push(']');
    }

    return lines.join('\n');
  }

  private escapeString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
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
