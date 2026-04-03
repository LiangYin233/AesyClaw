import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ZodError } from 'zod';
import * as smolToml from 'smol-toml';
import { FullConfigSchema, DEFAULT_CONFIG, type FullConfig } from './schema.js';
import { logger } from '../../platform/observability/logger.js';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: FullConfig | null = null;
  private initialized: boolean = false;
  private configPath: string;
  private selfUpdating: boolean = false;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.configPath = path.join(os.homedir(), '.aesyclaw', 'config.toml');
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

  private async ensureConfigDir(): Promise<void> {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      logger.info({ configDir }, 'Created config directory');
    }
  }

  private async loadConfig(): Promise<void> {
    await this.ensureConfigDir();

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
        this.config = parsed;
        logger.info({ path: this.configPath }, 'Config loaded successfully');
      } else {
        logger.warn({}, 'Config parse failed, using cached/default config');
      }
    } catch (error) {
      this.gracefulDegradation(error as Error);
    }
  }

  private parseConfig(content: string): FullConfig | null {
    try {
      const parsed = smolToml.parse(content);
      const result = FullConfigSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      logger.warn({ issues: this.formatZodErrors(result.error) }, 'Zod validation failed');
      return null;
    } catch (error) {
      logger.error({ error }, 'TOML parse error');
      return null;
    }
  }

  private async writeDefaultConfig(): Promise<void> {
    const defaultConfig = DEFAULT_CONFIG;
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
    return {
      ...current,
      ...updates,
      server: { ...current.server, ...updates.server },
      providers: { ...current.providers, ...updates.providers },
      agent: { ...current.agent, ...updates.agent },
      memory: { ...current.memory, ...updates.memory },
      channels: updates.channels ? { ...current.channels, ...updates.channels } : current.channels,
      mcp: updates.mcp ? { ...current.mcp, ...updates.mcp } : current.mcp,
      plugins: updates.plugins ? { ...current.plugins, ...updates.plugins } : current.plugins,
    };
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
      '',
      '[server]',
      `port = ${config.server.port}`,
      `host = "${config.server.host}"`,
      `log_level = "${config.server.logLevel}"`,
      `admin_token = "${config.server.adminToken}"`,
      '',
    ];

    if (Object.keys(config.providers).length > 0) {
      lines.push('[providers]');
      for (const [name, provider] of Object.entries(config.providers)) {
        if (provider) {
          lines.push(`[providers.${name}]`);
          if (provider.api_key) lines.push(`api_key = "${provider.api_key}"`);
          if (provider.base_url) lines.push(`base_url = "${provider.base_url}"`);
          if (provider.model) lines.push(`model = "${provider.model}"`);
          if (provider.temperature !== undefined) lines.push(`temperature = ${provider.temperature}`);
          if (provider.max_tokens !== undefined) lines.push(`max_tokens = ${provider.max_tokens}`);
          lines.push('');
        }
      }
    }

    if (config.channels && Object.keys(config.channels).length > 0) {
      lines.push('[channels]');
      for (const [name, channel] of Object.entries(config.channels)) {
        if (channel) {
          lines.push(`[channels.${name}]`);
          if ('enabled' in channel) lines.push(`enabled = ${channel.enabled}`);
          lines.push('');
        }
      }
    }

    lines.push('[agent]');
    lines.push(`default_model = "${config.agent.default_model}"`);
    lines.push(`default_temperature = ${config.agent.default_temperature}`);
    lines.push(`default_max_tokens = ${config.agent.default_max_tokens}`);
    lines.push(`system_prompt = "${this.escapeString(config.agent.system_prompt)}"`);
    lines.push(`max_turns = ${config.agent.max_turns}`);
    lines.push('');

    lines.push('[memory]');
    lines.push(`max_context_tokens = ${config.memory.max_context_tokens}`);
    lines.push(`compression_threshold = ${config.memory.compression_threshold}`);
    lines.push(`danger_threshold = ${config.memory.danger_threshold}`);
    lines.push('');

    if (config.mcp && config.mcp.servers && config.mcp.servers.length > 0) {
      lines.push('[mcp]');
      lines.push('servers = [');
      for (const server of config.mcp.servers) {
        lines.push('  {');
        lines.push(`    name = "${server.name}"`);
        lines.push(`    command = "${server.command}"`);
        lines.push(`    args = [${server.args.map(a => `"${a}"`).join(', ')}]`);
        if (server.env) {
          const envEntries = Object.entries(server.env).map(([k, v]) => `${k} = "${v}"`).join(', ');
          lines.push(`    env = { ${envEntries} }`);
        }
        lines.push(`    enabled = ${server.enabled}`);
        lines.push('  },');
      }
      lines.push(']');
      lines.push('');
    }

    if (config.plugins && config.plugins.plugins && config.plugins.plugins.length > 0) {
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
