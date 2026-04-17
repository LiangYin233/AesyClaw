import type { ChannelContext, MiddlewareFunc, PipelineState } from '@/agent/types.js';
import { configManager } from './config-manager.js';
import { logger } from '@/platform/observability/logger.js';

export const configStage: MiddlewareFunc = async (ctx: ChannelContext, next: () => Promise<void>) => {
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
