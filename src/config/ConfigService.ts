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
   * Update a section of the configuration
   * @param section Configuration section (plugins, mcp, channels, etc.)
   * @param key Key within the section
   * @param value Value to set
   */
  async updateConfigSection<T>(
    section: keyof Config,
    key: string,
    value: T
  ): Promise<void> {
    const config = this.get();

    // Initialize section if not exists
    if (!config[section] || typeof config[section] !== 'object') {
      (config as any)[section] = {};
    }

    // Update config
    (config[section] as any)[key] = value;

    // Save with validation
    await this.save(config);
    log.info(`Config ${String(section)}.${key} updated`);
  }

  /**
   * Remove a key from a configuration section
   * @param section Configuration section
   * @param key Key to remove
   */
  async removeConfigSection(
    section: keyof Config,
    key: string
  ): Promise<void> {
    const config = this.get();

    if (config[section] && typeof config[section] === 'object' && (config[section] as any)[key]) {
      delete (config[section] as any)[key];
      await this.save(config);
      log.info(`Config ${String(section)}.${key} removed`);
    }
  }

  /**
   * Update plugin configuration
   * @deprecated Use updateConfigSection('plugins', name, config) instead
   */
  async updatePluginConfig(
    name: string,
    enabled: boolean,
    options?: Record<string, any>
  ): Promise<void> {
    await this.updateConfigSection('plugins', name, {
      enabled,
      ...(options && { options })
    });
  }

  /**
   * Update MCP server configuration
   * @deprecated Use updateConfigSection('mcp', serverName, serverConfig) instead
   */
  async updateMCPConfig(
    serverName: string,
    serverConfig: any
  ): Promise<void> {
    await this.updateConfigSection('mcp', serverName, serverConfig);
  }

  /**
   * Remove MCP server configuration
   * @deprecated Use removeConfigSection('mcp', serverName) instead
   */
  async removeMCPConfig(serverName: string): Promise<void> {
    await this.removeConfigSection('mcp', serverName);
  }

  /**
   * Update channel configuration
   * @deprecated Use updateConfigSection('channels', channelName, channelConfig) instead
   */
  async updateChannelConfig(
    channelName: string,
    channelConfig: any
  ): Promise<void> {
    await this.updateConfigSection('channels', channelName, channelConfig);
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
