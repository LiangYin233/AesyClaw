import type { PluginConfigState } from './types.js';

export function normalizePluginConfigs(
  configs: Record<string, { enabled?: boolean; options?: Record<string, unknown> }>
): Record<string, PluginConfigState> {
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
