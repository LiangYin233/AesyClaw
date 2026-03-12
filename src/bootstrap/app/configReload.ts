import { ConfigLoader } from '../../config/loader.js';
import { createProvider } from '../../providers/index.js';
import { logger } from '../../logger/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import { createMemoryService } from '../factory/ServiceFactory.js';

const log = logger.child({ prefix: 'Bootstrap' });

export function setupConfigReload(services: Services): void {
  const { agent, apiServer, sessionManager, memoryFactStore } = services;
  let currentConfig = services.config;

  ConfigLoader.onReload(async (newConfig) => {
    const startedAt = Date.now();

    const oldProvider = currentConfig.agent.defaults.provider;
    const newProvider = newConfig.agent.defaults.provider;
    const oldModel = currentConfig.agent.defaults.model;
    const newModel = newConfig.agent.defaults.model;

    if (oldProvider !== newProvider ||
        newConfig.providers[newProvider]?.apiBase !== currentConfig.providers[oldProvider]?.apiBase ||
        oldModel !== newModel) {
      log.info('Config reload updating provider', {
        fromProvider: oldProvider,
        toProvider: newProvider,
        fromModel: oldModel,
        toModel: newModel
      });
      const newProviderInstance = createProvider(newProvider, newConfig.providers[newProvider]);
      agent.updateProvider(newProviderInstance, newModel);
    }

    const memoryService = createMemoryService(newConfig, sessionManager, memoryFactStore);
    agent.updateMemorySettings(newConfig.agent.defaults.memoryWindow, memoryService);

    currentConfig = newConfig;
    if (apiServer) {
      apiServer.updateConfig(currentConfig);
    }

    log.info('Config reload completed', {
      provider: currentConfig.agent.defaults.provider,
      model: currentConfig.agent.defaults.model,
      memoryWindow: currentConfig.agent.defaults.memoryWindow,
      durationMs: Date.now() - startedAt
    });
  });
}
