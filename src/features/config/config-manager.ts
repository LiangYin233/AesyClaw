import * as fs from 'fs';
import { ZodError } from 'zod';
import { pathResolver } from '../../platform/utils/paths.js';
import { FullConfigSchema, DEFAULT_CONFIG, type FullConfig } from './schema.js';
import { logger } from '../../platform/observability/logger.js';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: FullConfig | null = null;
  private initialized: boolean = false;
  private configPath: string;

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
      this.initialized = true;
      logger.info({ configPath: this.configPath }, 'ConfigManager initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize ConfigManager');
      throw error;
    }
  }

  private async loadConfig(): Promise<void> {
    if (!fs.existsSync(this.configPath)) {
      logger.info({ path: this.configPath }, 'Config file not found, generating default');
      await this.generateDefaultConfig();
      this.config = DEFAULT_CONFIG;
      return;
    }

    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8');
      const parsed = this.parseTOML(content);
      this.config = FullConfigSchema.parse(parsed);
      logger.info({ path: this.configPath }, 'Config loaded successfully');
    } catch (error) {
      if (error instanceof ZodError) {
        logger.error({ issues: error.issues }, 'Config validation failed');
        throw new Error(`Configuration validation failed: ${this.formatZodErrors(error)}`);
      }
      throw error;
    }
  }

  private parseTOML(content: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = content.split('\n');
    let currentSection: Record<string, unknown> = result;
    let sectionPath: string[] = [];

    for (let line of lines) {
      line = line.trim();

      if (!line || line.startsWith('#')) {
        continue;
      }

      if (line.startsWith('[') && line.endsWith(']')) {
        const sectionName = line.slice(1, -1);
        sectionPath = sectionName.split('.');
        currentSection = result;

        for (const part of sectionPath) {
          if (!currentSection[part]) {
            currentSection[part] = {};
          }
          currentSection = currentSection[part] as Record<string, unknown>;
        }
        continue;
      }

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1).trim();

      currentSection[key] = this.parseValue(value);
    }

    return result;
  }

  private parseValue(value: string): unknown {
    value = value.trim();

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    if (value === 'true') return true;
    if (value === 'false') return false;

    if (value === 'null' || value === 'nil') return null;

    const num = Number(value);
    if (!isNaN(num) && value !== '') {
      return num;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      const arrayContent = value.slice(1, -1).trim();
      if (!arrayContent) return [];
      return arrayContent.split(',').map(item => this.parseValue(item.trim()));
    }

    return value;
  }

  private async generateDefaultConfig(): Promise<void> {
    const configContent = `# AesyClaw Configuration File
# This file is auto-generated on first run

[server]
port = 3000
host = "0.0.0.0"
log_level = "info"

[providers]
# Uncomment and fill in your API credentials
# [providers.openai]
# api_key = "your-openai-api-key"
# model = "gpt-4o"

# [providers.anthropic]
# api_key = "your-anthropic-api-key"
# model = "claude-3-sonnet-20240229"

[channels]
# [channels.onebot]
# enabled = false
# ws_url = "ws://localhost:3001"

# [channels.discord]
# enabled = false
# token = "your-discord-token"

[agent]
default_model = "gpt-4o"
default_temperature = 0.7
default_max_tokens = 4096
system_prompt = "You are a helpful AI assistant."
max_turns = 50

[memory]
max_context_tokens = 128000
compression_threshold = 80000
danger_threshold = 30000
`;

    await fs.promises.writeFile(this.configPath, configContent, 'utf-8');
    logger.info({ path: this.configPath }, 'Default config file generated');
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

  getProviderCredential(provider: string) {
    const providers = this.getConfig().providers;
    return (providers as any)[provider] || null;
  }

  async reload(): Promise<void> {
    logger.info({}, 'Reloading configuration...');
    await this.loadConfig();
    logger.info({}, 'Configuration reloaded');
  }

  async updateConfig(updates: Partial<FullConfig>): Promise<void> {
    if (!this.config) throw new Error('ConfigManager not initialized');

    const merged = { ...this.config, ...updates };
    this.config = FullConfigSchema.parse(merged);

    const content = this.serializeToTOML(this.config);
    await fs.promises.writeFile(this.configPath, content, 'utf-8');
    logger.info({ path: this.configPath }, 'Configuration updated');
  }

  private serializeToTOML(config: FullConfig): string {
    const lines: string[] = [
      '# AesyClaw Configuration File',
      '',
      '[server]',
      `port = ${config.server.port}`,
      `host = "${config.server.host}"`,
      `log_level = "${config.server.logLevel}"`,
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

    if (Object.keys(config.channels).length > 0) {
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
}

export const configManager = ConfigManager.getInstance();
