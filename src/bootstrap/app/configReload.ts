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
import { reloadRuntimeConfig as reloadRuntimeConfigUsecase } from '../../agent/application/index.js';

const log = logger.child('Bootstrap');

export function setupConfigReload(services: Services): void {
  services.eventBus.on('config.changed', async ({ previousConfig, currentConfig }) => {
    const createReloadDeps = () => ({
      configStore: services.configStore,
      agentRuntime: services.agentRuntime,
      sessionRouting: services.sessionRouting,
      toolRegistry: services.toolRegistry,
      apiServer: services.apiServer,
      channelManager: services.channelManager,
      pluginManager: services.pluginManager,
      mcpManager: services.mcpManager,
      setMcpManager: (manager: NonNullable<typeof services.mcpManager>) => {
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
    });

    try {
      await reloadRuntimeConfigUsecase(createReloadDeps(), {
        previousConfig,
        currentConfig
      });
      services.config = currentConfig;
    } catch (error) {
      log.warn('配置热重载失败，正在回滚运行时状态', {
        error
      });

      try {
        await reloadRuntimeConfigUsecase(createReloadDeps(), {
          previousConfig: currentConfig,
          currentConfig: previousConfig
        });
        services.config = previousConfig;
      } catch (rollbackError) {
        log.error('配置热重载回滚失败', {
          error: rollbackError
        });
      }

      throw error;
    }
  });
}
