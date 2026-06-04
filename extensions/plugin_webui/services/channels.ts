import type { PluginContext } from '@aesyclaw/sdk';
import { serializeDefinition } from './definition';

export async function getChannels(ctx: PluginContext): Promise<Array<Record<string, unknown>>> {
  const channels = await ctx.control.channels.list();
  return await Promise.all(
    channels.map(async (channel) => ({
      ...serializeDefinition(await ctx.control.channels.definition(channel.name)),
      enabled: channel.enabled,
    })),
  );
}

export async function setChannelEnabled(
  ctx: PluginContext,
  name: string,
  enabled: boolean,
): Promise<void> {
  await ctx.config.global.set(`channels.${name}.enabled`, enabled);
}
