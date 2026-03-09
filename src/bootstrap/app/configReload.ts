import { ConfigLoader } from '../../config/loader.js';
import { createProvider } from '../../providers/index.js';
import { logger } from '../../logger/index.js';
import type { Services } from '../factory/ServiceFactory.js';

const log = logger.child({ prefix: 'Bootstrap' });

export function setupConfigReload(services: Services): void {
  const { agent, apiServer } = services;
  let currentConfig = services.config;

  ConfigLoader.onReload(async (newConfig) => {
    log.info('Config reload triggered');

    const oldProvider = currentConfig.agent.defaults.provider;
    const newProvider = newConfig.agent.defaults.provider;
    const oldModel = currentConfig.agent.defaults.model;
    const newModel = newConfig.agent.defaults.model;

    if (oldProvider !== newProvider ||
        newConfig.providers[newProvider]?.apiBase !== currentConfig.providers[oldProvider]?.apiBase ||
        oldModel !== newModel) {
      log.info('Provider/model changed, updating agent');
      const newProviderInstance = createProvider(newProvider, newConfig.providers[newProvider]);
      agent.updateProvider(newProviderInstance, newModel);
    }

    currentConfig = newConfig;
    if (apiServer) {
      apiServer.updateConfig(currentConfig);
    }
  });
}
