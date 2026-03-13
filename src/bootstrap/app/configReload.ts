import { ConfigLoader } from '../../config/loader.js';
import { resolveProviderSelection } from '../../config/index.js';
import { createProvider } from '../../providers/index.js';
import { logger } from '../../logger/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import { createMemoryService } from '../factory/ServiceFactory.js';

const log = logger.child({ prefix: 'Bootstrap' });

export function setupConfigReload(services: Services): void {
  const { agentRuntime, apiServer, sessionManager, memoryFactStore } = services;
  let currentConfig = services.config;

  ConfigLoader.onReload(async (newConfig) => {
    const startedAt = Date.now();

    const oldProvider = resolveProviderSelection(currentConfig);
    const newProvider = resolveProviderSelection(newConfig);

    if (oldProvider.name !== newProvider.name ||
        newProvider.providerConfig?.apiBase !== oldProvider.providerConfig?.apiBase ||
        oldProvider.model !== newProvider.model) {
      log.info('Config reload updating provider', {
        fromProvider: oldProvider.name,
        toProvider: newProvider.name,
        fromModel: oldProvider.model,
        toModel: newProvider.model
      });
      if (!newProvider.providerConfig) {
        throw new Error(`Default provider "${newProvider.name}" not found in config`);
      }

      const newProviderInstance = createProvider(newProvider.name, newProvider.providerConfig);
      agentRuntime.updateProvider(newProviderInstance, newProvider.model);
    }

    const memoryService = createMemoryService(newConfig, sessionManager, memoryFactStore);
    agentRuntime.updateMemorySettings(newConfig.agent.defaults.memoryWindow, memoryService);

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
