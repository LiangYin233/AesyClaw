import type { ChannelContext, MiddlewareFunc, PipelineState } from '@/agent/types.js';
import { configManager } from './config-manager.js';
import type { FullConfig } from './schema.js';
import { logger } from '@/platform/observability/logger.js';

type ConfigStageSource = {
    isInitialized(): boolean;
    initialize(): Promise<void>;
    getConfig(): FullConfig;
};

export function createConfigStage(configSource: ConfigStageSource): MiddlewareFunc {
    return async (ctx: ChannelContext, next: () => Promise<void>) => {
        if (!configSource.isInitialized()) {
            logger.warn({}, 'ConfigManager not initialized, attempting to initialize...');
            await configSource.initialize();
        }

        const config = configSource.getConfig();

        if (!ctx.state) {
            ctx.state = {} as PipelineState;
        }

        ctx.state.config = { config };

        logger.debug(
            {
                hasServer: !!config.server,
                hasProviders: Object.keys(config.providers || {}).length > 0,
                hasChannels: config.channels ? Object.keys(config.channels).length > 0 : false,
                hasAgent: !!config.agent,
            },
            'Config injected into context',
        );

        await next();
    };
}

export const configStage: MiddlewareFunc = createConfigStage({
    isInitialized: () => configManager.isInitialized(),
    initialize: () => configManager.initialize(),
    getConfig: () => configManager.config,
});
