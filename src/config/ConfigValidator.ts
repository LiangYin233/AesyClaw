/**
 * Configuration Validator
 *
 * Validates configuration objects to ensure they meet requirements
 * before being saved or applied.
 */

import type { Config } from '../types.js';
import { logger } from '../logger/index.js';

const log = logger.child({ prefix: 'ConfigValidator' });

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ConfigValidator {
  /**
   * Validate a configuration object
   */
  validate(config: Config): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate agent configuration
    if (!config.agent?.defaults?.provider) {
      errors.push('agent.defaults.provider is required');
    }

    if (!config.agent?.defaults?.model) {
      errors.push('agent.defaults.model is required');
    }

    // Validate LLM provider configuration
    const provider = config.agent?.defaults?.provider;
    if (provider && !config.providers?.[provider]) {
      errors.push(`LLM provider "${provider}" is not configured in providers section`);
    }

    // Validate provider has required fields
    if (provider && config.providers?.[provider]) {
      const providerConfig = config.providers[provider];
      if (!providerConfig.apiKey && !process.env[`${provider.toUpperCase()}_API_KEY`]) {
        warnings.push(`Provider "${provider}" has no apiKey configured`);
      }
    }

    // Validate server ports
    if (config.server?.port) {
      if (config.server.port < 1 || config.server.port > 65535) {
        errors.push(`Invalid server.port: ${config.server.port} (must be 1-65535)`);
      }
    }

    if (config.server?.apiPort) {
      if (config.server.apiPort < 1 || config.server.apiPort > 65535) {
        errors.push(`Invalid server.apiPort: ${config.server.apiPort} (must be 1-65535)`);
      }
    }

    if (config.server?.webuiPort) {
      if (config.server.webuiPort < 1 || config.server.webuiPort > 65535) {
        errors.push(`Invalid server.webuiPort: ${config.server.webuiPort} (must be 1-65535)`);
      }
    }

    // Validate context mode
    const validContextModes = ['session', 'channel', 'global'];
    if (config.agent?.defaults?.contextMode &&
        !validContextModes.includes(config.agent.defaults.contextMode)) {
      errors.push(`Invalid contextMode: ${config.agent.defaults.contextMode} (must be one of: ${validContextModes.join(', ')})`);
    }

    // Validate max iterations
    if (config.agent?.defaults?.maxToolIterations !== undefined) {
      if (config.agent.defaults.maxToolIterations < 0) {
        errors.push('maxToolIterations must be >= 0');
      }
      if (config.agent.defaults.maxToolIterations > 100) {
        warnings.push('maxToolIterations > 100 may cause performance issues');
      }
    }

    // Validate memory window
    if (config.agent?.defaults?.memoryWindow !== undefined) {
      if (config.agent.defaults.memoryWindow < 0) {
        errors.push('memoryWindow must be >= 0');
      }
    }

    // Validate max sessions
    if (config.agent?.defaults?.maxSessions !== undefined) {
      if (config.agent.defaults.maxSessions < 1) {
        errors.push('maxSessions must be >= 1');
      }
    }

    // Validate channel configurations
    if (config.channels) {
      for (const [channelName, channelConfig] of Object.entries(config.channels)) {
        if (channelConfig?.enabled) {
          if (channelName === 'onebot') {
            if (!channelConfig.wsUrl) {
              warnings.push(`Channel "${channelName}" is enabled but wsUrl is not configured`);
            }
          }
        }
      }
    }

    // Log validation results
    if (errors.length > 0) {
      log.error(`Configuration validation failed with ${errors.length} error(s)`);
      errors.forEach(err => log.error(`  - ${err}`));
    }

    if (warnings.length > 0) {
      log.warn(`Configuration has ${warnings.length} warning(s)`);
      warnings.forEach(warn => log.warn(`  - ${warn}`));
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate and throw if invalid
   */
  validateOrThrow(config: Config): void {
    const result = this.validate(config);
    if (!result.valid) {
      throw new Error(`Invalid configuration:\n${result.errors.join('\n')}`);
    }
  }
}
