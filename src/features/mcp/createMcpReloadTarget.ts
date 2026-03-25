import type { ConfigReloadTargets } from '../../config/reload/ports/ReloadTargets.js';
import { syncConfiguredMcpServers } from '../../mcp/runtime.js';
import type { Services } from '../../bootstrap/factory/ServiceFactory.js';

export function createMcpReloadTarget(services: Services): NonNullable<ConfigReloadTargets['mcp']> {
  return {
    async applyConfig(config) {
      await syncConfiguredMcpServers({
        getMcpManager: () => services.mcpManager ?? undefined,
        setMcpManager: (manager) => {
          services.mcpManager = manager;
        },
        toolRegistry: services.toolRegistry
      }, config);
    }
  };
}
