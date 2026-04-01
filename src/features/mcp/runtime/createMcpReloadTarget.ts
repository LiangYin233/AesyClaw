import { syncConfiguredMcpServers } from '../index.js';
import type { Services } from '../../../app/bootstrap/factory/runtimeServiceTypes.js';
import type { Config } from '../../../types.js';

interface McpReloadHandler {
  applyConfig(config: Config): Promise<void>;
}

export function createMcpReloadTarget(services: Services): McpReloadHandler {
  return {
    async applyConfig(config) {
      await syncConfiguredMcpServers({
        getMcpManager: () => services.mcpManager ?? undefined,
        setMcpManager: (manager) => {
          services.mcpManager = manager ?? null;
          services.webServer?.setMcpManager(manager);
        },
        toolRegistry: services.toolRegistry
      }, config);
    }
  };
}
