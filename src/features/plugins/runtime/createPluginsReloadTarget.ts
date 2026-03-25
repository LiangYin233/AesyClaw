import type { ConfigReloadTargets } from '../../../config/reload/ports/ReloadTargets.js';
import type { Services } from '../../../app/bootstrap/factory/ServiceFactory.js';

function normalizePluginConfigs(
  configs: Record<string, { enabled?: boolean; options?: Record<string, unknown> }>
) {
  return Object.fromEntries(
    Object.entries(configs).map(([name, config]) => [
      name,
      {
        enabled: config.enabled ?? false,
        options: config.options ? structuredClone(config.options) : undefined
      }
    ])
  );
}

export function createPluginsReloadTarget(services: Services): NonNullable<ConfigReloadTargets['plugins']> {
  return {
    async applyConfig(config) {
      await services.pluginManager.loadFromConfig(
        normalizePluginConfigs(config.plugins as Record<string, { enabled?: boolean; options?: Record<string, unknown> }>)
      );
    }
  };
}
