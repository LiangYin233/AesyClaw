import type { PluginDefinition, PluginOptions } from './types.js';

export function definePlugin<TOptions extends PluginOptions = PluginOptions>(
  plugin: PluginDefinition<TOptions>
): PluginDefinition<TOptions> {
  return plugin;
}
