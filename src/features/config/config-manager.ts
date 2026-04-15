import * as fs from 'fs';
import * as path from 'path';
import type { PluginRuntimeConfig } from '@/contracts/commands.js';
import { ZodError } from 'zod';
import { logger } from '@/platform/observability/logger.js';
import { pathResolver } from '@/platform/utils/paths.js';
import { FullConfigSchema, DEFAULT_CONFIG, type FullConfig, type ProvidersConfig, type ChannelsConfig, type MCPServerConfig } from './schema.js';
import { ConfigStore } from './config-store.js';
import { loadConfig, watchConfig } from 'c12';
import defu from 'defu';

interface ParsedConfig {
  providers?: Record<string, unknown>;
  mcp?: { servers?: unknown[] };
  channels?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ParseResult {
  config: FullConfig | null;
  shouldWriteBack: boolean;
}

type ConfigChangeListener = (_next: FullConfig, _prev: FullConfig) => void | Promise<void>;

export class ConfigManager {
  private store: ConfigStore;
  private initialized = false;
  private configPath: string;
  private selfUpdating = false;
  private watcher: { unwatch: () => void } | null = null;
  private pendingPluginDefaults = new Map<string, Record<string, unknown>>();
  private pendingChannelDefaults = new Map<string, Record<string, unknown>>();
  private configChangeListeners = new Set<ConfigChangeListener>();
  private enableDotenv: boolean;
  private layers: Array<{ config: unknown; configFile?: string; cwd?: string }> = [];

  get config(): FullConfig {
    if (!this.initialized) throw new Error('ConfigManager not initialized');
    return this.store.readonlyView;
  }

  constructor(options: { enableDotenv?: boolean } = {}) {
    this.configPath = pathResolver.getConfigFilePath();
    this.store = new ConfigStore(DEFAULT_CONFIG);
    this.enableDotenv = options.enableDotenv ?? false;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.initializeWithC12();
      this.initialized = true;
      logger.info({ configPath: this.configPath }, 'ConfigManager initialized with c12 hot-reload');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize ConfigManager');
      throw error;
    }
  }

  private async initializeWithC12(): Promise<void> {
    const result = await loadConfig({
      cwd: path.dirname(this.configPath),
      configFile: path.basename(this.configPath),
      name: 'config',
      defaults: DEFAULT_CONFIG,
      dotenv: this.enableDotenv ? { fileName: '.env' } : false,
    });

    if (result.config) {
      this.layers = result.layers || [];
      const parsed = this.parseConfigFromRaw(result.config);
      await this.applyParsedResult(parsed, {
        failureMsg: 'Config parse failed, using cached/default config',
        successMsg: 'Config loaded successfully',
        writeBackMsg: 'Updated config file with default values',
        beforeWriteBackMsg: 'Config was incomplete, added missing fields with defaults',
      });
    } else {
      this.store.replace(DEFAULT_CONFIG);
      await this.writeDefaultConfig();
    }

    this.setupWatchWithC12();
  }

  private parseConfigFromRaw(raw: unknown): ParseResult {
    try {
      const parsed = raw as ParsedConfig;
      const result = FullConfigSchema.safeParse(parsed);

      if (result.success) {
        let shouldWriteBack = false;

        if (this.isEmpty(parsed.providers)) {
          result.data.providers = { openai: { type: 'openai_chat', api_key: 'your-api-key', base_url: 'https://api.openai.com/v1', models: { default: { modelname: 'gpt-4o', contextWindow: 128000, reasoning: false } } } };
          shouldWriteBack = true;
          logger.info({}, 'No providers configured, adding default provider example');
        }
        if (this.isEmpty(parsed.mcp?.servers)) {
          result.data.mcp = { servers: [{ name: 'example', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', './skills'], enabled: false }] };
          shouldWriteBack = true;
          logger.info({}, 'No MCP servers configured, adding default MCP server example');
        }
        if (this.isEmpty(parsed.channels)) {
          result.data.channels = {};
          shouldWriteBack = true;
          logger.info({}, 'No channels configured, channels will be loaded from plugins');
        }

        return { config: result.data, shouldWriteBack };
      }

      logger.warn({ issues: this.formatZodErrors(result.error) }, 'Zod validation failed, attempting to fill missing fields with defaults');

      const rawProviders: unknown = parsed.providers;
      const rawMCPServers: unknown = parsed.mcp?.servers;
      const rawChannels: unknown = parsed.channels;
      const hasProviders = !this.isEmpty(rawProviders);
      const hasMCPServers = !this.isEmpty(rawMCPServers);
      const hasChannels = !this.isEmpty(rawChannels);

      const mcpServersDefault = [{ name: 'example', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', './skills'], enabled: false }];
      const mcpServersVal: MCPServerConfig[] = hasMCPServers ? (rawMCPServers as MCPServerConfig[]) : mcpServersDefault;

      const merged = {
        ...DEFAULT_CONFIG,
        ...(parsed as unknown as Record<string, unknown>),
        providers: hasProviders ? (rawProviders as ProvidersConfig) : { openai: { type: 'openai_chat', api_key: 'your-api-key', base_url: 'https://api.openai.com/v1', models: { default: { modelname: 'gpt-4o', contextWindow: 128000, reasoning: false } } } },
        mcp: { servers: mcpServersVal },
        channels: hasChannels ? (rawChannels as ChannelsConfig) : {},
      } as unknown as FullConfig;

      const mergedResult = FullConfigSchema.safeParse(merged);
      if (mergedResult.success) {
        if (!hasProviders) logger.info({}, 'No providers configured, adding default provider example');
        if (!hasMCPServers) logger.info({}, 'No MCP servers configured, adding default MCP server example');
        if (!hasChannels) logger.info({}, 'No channels configured, adding default channel example');
        if (hasProviders || hasMCPServers || hasChannels) logger.info({}, 'Successfully merged user config with defaults');
        return { config: mergedResult.data, shouldWriteBack: true };
      }

      logger.warn({}, 'Partial config merge also failed, keeping existing config');
      return { config: null, shouldWriteBack: false };
    } catch (error) {
      logger.error({ error }, 'Config parse error, keeping existing config');
      return { config: null, shouldWriteBack: false };
    }
  }

  private isEmpty(value: unknown): boolean {
    if (value === undefined) return true;
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0) return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }

  private async writeDefaultConfig(): Promise<void> {
    const defaultConfig = { ...DEFAULT_CONFIG, channels: {} };
    await fs.promises.writeFile(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    logger.info({ path: this.configPath }, 'Default config file generated');
  }

  private async setupWatchWithC12(): Promise<void> {
    if (this.watcher) return;

    try {
      const watchResult = await watchConfig({
        cwd: path.dirname(this.configPath),
        configFile: path.basename(this.configPath),
        name: 'config',
        defaults: DEFAULT_CONFIG,
        dotenv: this.enableDotenv ? { fileName: '.env' } : false,
        debounce: 200,
        onWatch: (event) => {
          logger.debug({}, `Config file ${event.type}: ${event.path}`);
        },
        acceptHMR: async ({ newConfig }) => {
          try {
            const parsed = this.parseConfigFromRaw(newConfig);
            if (!parsed.config) {
              logger.warn({}, 'HMR rejected: merged config failed Zod validation, keeping previous snapshot');
              return true;
            }
            return false;
          } catch {
            logger.warn({}, 'HMR rejected: exception during validation, keeping previous snapshot');
            return true;
          }
        },
        onUpdate: async ({ newConfig }) => {
          if (this.selfUpdating) {
            logger.debug({}, 'Ignoring self-triggered config update');
            return;
          }
          logger.info({}, 'Reloading configuration via c12...');
          try {
            const parsed = this.parseConfigFromRaw(newConfig);
            await this.applyParsedResult(parsed, {
              failureMsg: 'Config reload failed, keeping old config',
              successMsg: 'Configuration reloaded successfully',
              writeBackMsg: 'Updated config file with default values after reload',
            });
          } catch (error) {
            this.gracefulDegradation(error as Error);
          }
        },
      });

      this.watcher = watchResult;
      logger.info({}, 'c12 watchConfig setup successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to setup c12 watchConfig');
    }
  }

  private async applyParsedResult(
    parsed: ParseResult,
    opts: { failureMsg: string; successMsg: string; writeBackMsg: string; beforeWriteBackMsg?: string }
  ): Promise<void> {
    if (!parsed.config) {
      logger.warn({}, opts.failureMsg);
      return;
    }

    if (parsed.shouldWriteBack) {
      if (opts.beforeWriteBackMsg) logger.info({}, opts.beforeWriteBackMsg);
      await this.saveToDisk(parsed.config);
      logger.info({ path: this.configPath }, opts.writeBackMsg);
    }

    const prev = this.store.snapshot;
    this.store.replace(parsed.config);
    logger.info({ path: this.configPath }, opts.successMsg);

    if (prev !== this.store.snapshot) {
      await this.notifyConfigChange(parsed.config, prev);
    }
  }

  private async saveToDisk(config: FullConfig): Promise<void> {
    this.selfUpdating = true;
    try {
      await fs.promises.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } finally {
      setTimeout(() => { this.selfUpdating = false; }, 100);
    }
  }

  private gracefulDegradation(error: Error): void {
    logger.error({ error }, 'Config system error, using cached config');
    this.store.replace(DEFAULT_CONFIG);
    logger.info({}, 'Using default config as fallback');
  }

  private formatZodErrors(error: ZodError): string {
    return error.issues.map(e => `${e.path?.join('.') || 'unknown'}: ${e.message}`).join('; ');
  }

  getConfig(): FullConfig {
    return this.config;
  }

  getConfigLayers(): Array<{ config: unknown; configFile?: string; cwd?: string }> {
    return this.layers;
  }

  onConfigChange(listener: ConfigChangeListener): () => void {
    this.configChangeListeners.add(listener);
    return () => { this.configChangeListeners.delete(listener); };
  }

  async updateChannelConfig(channelName: string, config: Record<string, unknown>): Promise<boolean> {
    if (!this.initialized) { logger.error({}, 'ConfigManager not initialized'); return false; }
    try {
      return this.updateConfig({ channels: { ...this.store.snapshot.channels, [channelName]: { ...this.store.snapshot.channels?.[channelName], ...config } } });
    } catch (error) {
      logger.error({ error, channelName }, 'Failed to update channel config');
      return false;
    }
  }

  registerPluginDefaults(name: string, defaults: Record<string, unknown>): void {
    this.pendingPluginDefaults.set(name, defaults);
  }

  getPluginConfig(name: string): PluginRuntimeConfig | undefined {
    const plugin = this.config.plugins.find(e => e.name === name);
    if (!plugin) return undefined;
    return { name: plugin.name, enabled: plugin.enabled, options: plugin.options };
  }

  registerChannelDefaults(name: string, defaults: Record<string, unknown>): void {
    this.pendingChannelDefaults.set(name, defaults);
  }

  async syncAllDefaultConfigs(): Promise<void> {
    if (!this.initialized) { logger.error({}, 'ConfigManager not initialized'); return; }
    await this.syncPluginDefaults();
    await this.syncChannelDefaults();
  }

  private async syncPluginDefaults(): Promise<void> {
    if (this.pendingPluginDefaults.size === 0) return;
    for (const [name, defaults] of this.pendingPluginDefaults) {
      const existing = (this.store.snapshot.plugins || []).find(p => p.name === name);
      if (!existing || !existing.options || Object.keys(existing.options).length === 0) {
        await this.updatePluginConfig(name, true, defaults);
      }
    }
  }

  private async syncChannelDefaults(): Promise<void> {
    if (this.pendingChannelDefaults.size === 0) return;
    for (const [name, defaults] of this.pendingChannelDefaults) {
      const existing = this.store.snapshot.channels?.[name];
      if (!existing || Object.keys(existing).length === 0) {
        await this.updateChannelConfig(name, defaults);
      }
    }
  }

  async updatePluginConfig(name: string, enabled: boolean, options?: Record<string, unknown>): Promise<boolean> {
    if (!this.initialized) { logger.error({}, 'ConfigManager not initialized'); return false; }
    try {
      const plugins = (this.store.snapshot.plugins || []).map(p => ({ ...p, options: p.options ? { ...p.options } : {} }));
      const idx = plugins.findIndex(p => p.name === name);
      if (idx >= 0) {
        plugins[idx].enabled = enabled;
        if (options) plugins[idx].options = options;
      } else {
        plugins.push({ name, enabled, options: options || {} });
      }
      return this.updateConfig({ plugins });
    } catch (error) {
      logger.error({ error, name, enabled }, 'Failed to update plugin config');
      return false;
    }
  }

  async updateConfig(updates: Partial<FullConfig>): Promise<boolean> {
    if (!this.initialized) { logger.error({}, 'ConfigManager not initialized'); return false; }
    try {
      const merged = defu(updates, this.store.snapshot) as FullConfig;
      const result = FullConfigSchema.safeParse(merged);
      if (!result.success) {
        logger.warn({ issues: this.formatZodErrors(result.error) }, 'Update validation failed');
        return false;
      }
      const prev = this.store.snapshot;
      this.store.replace(result.data);
      this.saveToDisk(result.data);
      await this.notifyConfigChange(result.data, prev);
      return true;
    } catch (error) {
      logger.error({ error }, 'Update config failed');
      return false;
    }
  }

  private async notifyConfigChange(next: FullConfig, prev: FullConfig): Promise<void> {
    for (const listener of this.configChangeListeners) {
      try {
        await listener(next, prev);
      } catch (error) {
        logger.error({ error }, 'Config change listener failed');
      }
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  destroy(): void {
    if (this.watcher) { this.watcher.unwatch(); this.watcher = null; }
    this.configChangeListeners.clear();
    logger.info({}, 'ConfigManager destroyed');
  }
}

export const configManager = new ConfigManager();