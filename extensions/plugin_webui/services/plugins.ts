import type { PluginContext } from '@aesyclaw/sdk';
import { serializeDefinition } from './definition';

export async function getPlugins(ctx: PluginContext): Promise<Array<Record<string, unknown>>> {
  const plugins = await ctx.control.plugins.list();
  return await Promise.all(
    plugins.map(async (plugin) => ({
      ...serializeDefinition(await ctx.control.plugins.definition(plugin.name)),
      enabled: plugin.enabled,
    })),
  );
}

export async function setPluginEnabled(
  ctx: PluginContext,
  name: string,
  enabled: boolean,
): Promise<void> {
  await ctx.config.global.set(`plugins.${name}.enabled`, enabled);
}
