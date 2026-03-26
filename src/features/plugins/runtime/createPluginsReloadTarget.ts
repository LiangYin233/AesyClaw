import type { ConfigReloadTargets } from '../../../features/config/reload/ports/ReloadTargets.js';
import type { Services } from '../../../app/bootstrap/factory/ServiceFactory.js';
import { normalizePluginConfigs } from '../domain/config.js';

export function createPluginsReloadTarget(services: Services): NonNullable<ConfigReloadTargets['plugins']> {
  return {
    async applyConfig(config) {
      await services.pluginManager.loadFromConfig(
        normalizePluginConfigs(config.plugins as Record<string, { enabled?: boolean; options?: Record<string, unknown> }>)
      );
    }
  };
}
