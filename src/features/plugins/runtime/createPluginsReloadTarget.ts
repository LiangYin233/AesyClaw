import type { Services } from '../../../app/bootstrap/factory/ServiceFactory.js';
import { normalizePluginConfigs } from '../domain/config.js';
import type { Config } from '../../../types.js';

interface PluginsReloadHandler {
  applyConfig(config: Config): Promise<void>;
}

export function createPluginsReloadTarget(services: Services): PluginsReloadHandler {
  return {
    async applyConfig(config) {
      await services.pluginManager.loadFromConfig(
        normalizePluginConfigs(config.plugins as Record<string, { enabled?: boolean; options?: Record<string, unknown> }>)
      );
    }
  };
}
