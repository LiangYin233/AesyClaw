/**
 * Configuration Service
 *
 * Provides a clean interface for configuration management.
 * Handles loading, saving, validation, and business logic related to config.
 */

import type { Config } from '../types.js';
import { ConfigLoader } from './loader.js';
import { ConfigValidator } from './ConfigValidator.js';
import { logger } from '../logger/index.js';

const log = logger.child({ prefix: 'ConfigService' });

export class ConfigService {
  private validator: ConfigValidator;

  constructor() {
    this.validator = new ConfigValidator();
  }

  /**
   * Get current configuration
   */
  get(): Config {
    return ConfigLoader.get();
  }

  /**
   * Save configuration with validation
   */
  async save(config: Config): Promise<void> {
    // Validate configuration
    const result = this.validator.validate(config);

    if (!result.valid) {
      const errorMsg = `Configuration validation failed:\n${result.errors.join('\n')}`;
      log.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Log warnings but don't block save
    if (result.warnings.length > 0) {
      result.warnings.forEach(warn => log.warn(warn));
    }

    // Save configuration
    await ConfigLoader.save(config);
    log.info('Configuration saved successfully');
  }

  /**
   * Watch for configuration changes
   */
  watch(callback: (config: Config) => void | Promise<void>): void {
    ConfigLoader.onReload(callback);
  }

  /**
   * Update plugin configuration
   */
  async updatePluginConfig(
    name: string,
    enabled: boolean,
    options?: Record<string, any>
  ): Promise<void> {
    const config = this.get();

    // Initialize plugins object if not exists
    if (!config.plugins) {
      config.plugins = {};
    }

    // Update plugin config
    config.plugins[name] = {
      enabled,
      ...(options && { options })
    };

    // Save with validation
    await this.save(config);
    log.info(`Plugin "${name}" config updated: enabled=${enabled}`);
  }

  /**
   * Update MCP server configuration
   */
  async updateMCPConfig(
    serverName: string,
    serverConfig: any
  ): Promise<void> {
    const config = this.get();

    // Initialize mcp object if not exists
    if (!config.mcp) {
      config.mcp = {};
    }

    // Update MCP server config
    config.mcp[serverName] = serverConfig;

    // Save with validation
    await this.save(config);
    log.info(`MCP server "${serverName}" config updated`);
  }

  /**
   * Remove MCP server configuration
   */
  async removeMCPConfig(serverName: string): Promise<void> {
    const config = this.get();

    if (config.mcp && config.mcp[serverName]) {
      delete config.mcp[serverName];
      await this.save(config);
      log.info(`MCP server "${serverName}" config removed`);
    }
  }

  /**
   * Update channel configuration
   */
  async updateChannelConfig(
    channelName: string,
    channelConfig: any
  ): Promise<void> {
    const config = this.get();

    // Initialize channels object if not exists
    if (!config.channels) {
      config.channels = {};
    }

    // Update channel config
    config.channels[channelName] = channelConfig;

    // Save with validation
    await this.save(config);
    log.info(`Channel "${channelName}" config updated`);
  }

  /**
   * Validate configuration without saving
   */
  validate(config: Config): { valid: boolean; errors: string[]; warnings: string[] } {
    return this.validator.validate(config);
  }

  /**
   * Reload configuration from disk
   */
  async reload(): Promise<Config> {
    const config = await ConfigLoader.load();
    log.info('Configuration reloaded from disk');
    return config;
  }
}
