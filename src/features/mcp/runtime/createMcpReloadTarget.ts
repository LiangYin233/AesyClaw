import type { ConfigReloadTargets } from '../../../features/config/reload/ports/ReloadTargets.js';
import { syncConfiguredMcpServers } from '../index.js';
import type { Services } from '../../../app/bootstrap/factory/ServiceFactory.js';

export function createMcpReloadTarget(services: Services): NonNullable<ConfigReloadTargets['mcp']> {
  return {
    async applyConfig(config) {
      await syncConfiguredMcpServers({
        getMcpManager: () => services.mcpManager ?? undefined,
        setMcpManager: (manager) => {
          services.mcpManager = manager ?? null;
          services.apiServer?.setMcpManager(manager);
        },
        toolRegistry: services.toolRegistry
      }, config);
    }
  };
}
