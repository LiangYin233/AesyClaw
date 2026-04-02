import { configManager, type FullConfig } from '../features/config/index.js';
import { logger } from '../platform/observability/logger.js';
import type { IChannelContext, MiddlewareFunc } from '../agent/core/types.js';

export interface ConfigState {
  config: FullConfig;
}

export class ConfigInjectionMiddleware {
  name = 'ConfigInjectionMiddleware';

  getMiddleware(): MiddlewareFunc {
    return async (ctx: IChannelContext, next: () => Promise<void>) => {
      if (!configManager.isInitialized()) {
        logger.warn({}, 'ConfigManager not initialized, attempting to initialize...');
        await configManager.initialize();
      }

      const config = configManager.getConfig();

      if (!ctx.state) {
        ctx.state = { config };
      } else {
        (ctx.state as unknown as ConfigState).config = config;
      }

      logger.debug({
        hasServer: !!config.server,
        hasProviders: Object.keys(config.providers).length > 0,
        hasChannels: Object.keys(config.channels).length > 0,
        hasAgent: !!config.agent,
      }, 'Config injected into context');

      await next();
    };
  }
}

export const configInjectionMiddleware = new ConfigInjectionMiddleware();

export function getConfigFromContext(ctx: IChannelContext): FullConfig {
  const configState = ctx.state as unknown as ConfigState;
  if (!configState?.config) {
    if (configManager.isInitialized()) {
      return configManager.getConfig();
    }
    throw new Error('No config available in context and ConfigManager not initialized');
  }
  return configState.config;
}
