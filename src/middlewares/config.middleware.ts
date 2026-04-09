import { configManager, type FullConfig } from '../features/config/index.js';
import { logger } from '../platform/observability/logger.js';
import type { IChannelContext, MiddlewareFunc, PipelineState } from '../agent/core/types.js';

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

      const config = configManager.config;

      if (!ctx.state) {
        ctx.state = {} as PipelineState;
      }

      ctx.state.config = { config };

      logger.debug({
        hasServer: !!config.server,
        hasProviders: Object.keys(config.providers || {}).length > 0,
        hasChannels: config.channels ? Object.keys(config.channels).length > 0 : false,
        hasAgent: !!config.agent,
      }, 'Config injected into context');

      await next();
    };
  }
}

export const configInjectionMiddleware = new ConfigInjectionMiddleware();

export function getConfigFromContext(ctx: IChannelContext): FullConfig {
  const configState = ctx.state?.config;
  if (!configState?.config) {
    if (configManager.isInitialized()) {
      return configManager.config;
    }
    throw new Error('No config available in context and ConfigManager not initialized');
  }
  return configState.config as FullConfig;
}
