import {
  getMainAgentConfig,
  getMemoryConfig,
  getObservabilityConfig,
  getSessionRuntimeConfig,
  getToolRuntimeConfig
} from '../../config/index.js';
import { logging, logger } from '../../observability/index.js';
import { syncConfiguredMcpServers } from '../../mcp/runtime.js';
import { createProvider } from '../../providers/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import { createMemoryService } from '../factory/ServiceFactory.js';
import { reloadRuntimeConfig as reloadRuntimeConfigUsecase } from '../../agent/usecases/index.js';

const log = logger.child('Bootstrap');

export function setupConfigReload(services: Services): void {
  services.eventBus.on('config.changed', async ({ previousConfig, currentConfig }) => {
    await reloadRuntimeConfigUsecase({
      configStore: services.configStore,
      agentRuntime: services.agentRuntime,
      sessionRouting: services.sessionRouting,
      toolRegistry: services.toolRegistry,
      apiServer: services.apiServer,
      mcpManager: services.mcpManager,
      setMcpManager: (manager) => {
        services.mcpManager = manager;
      },
      sessionManager: services.sessionManager,
      longTermMemoryStore: services.longTermMemoryStore,
      skillManager: services.skillManager,
      createProvider,
      createMemoryService,
      syncConfiguredMcpServers,
      logging,
      logger: log,
      selectors: {
        getMainAgentConfig,
        getMemoryConfig,
        getObservabilityConfig,
        getSessionRuntimeConfig,
        getToolRuntimeConfig
      }
    }, {
      previousConfig,
      currentConfig
    });
    services.config = currentConfig;
  });
}
