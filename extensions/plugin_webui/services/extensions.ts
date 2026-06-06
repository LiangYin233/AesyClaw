import type { PluginContext } from '@aesyclaw/sdk';
import { serializeDefinition } from './definition';

type ExtensionKind = 'channels' | 'plugins';

type ExtensionControl = {
  list(): Promise<Array<{ name: string; enabled: boolean }>>;
  definition(name: string): Promise<unknown>;
};

function getControl(ctx: PluginContext, kind: ExtensionKind): ExtensionControl {
  return kind === 'channels' ? ctx.control.channels : ctx.control.plugins;
}

export async function listExtensions(
  ctx: PluginContext,
  kind: ExtensionKind,
): Promise<Array<Record<string, unknown>>> {
  const control = getControl(ctx, kind);
  const extensions = await control.list();
  return await Promise.all(
    extensions.map(async (extension) => ({
      ...serializeDefinition(await control.definition(extension.name)),
      enabled: extension.enabled,
    })),
  );
}

export async function setExtensionEnabled(
  ctx: PluginContext,
  kind: ExtensionKind,
  name: string,
  enabled: boolean,
): Promise<void> {
  await ctx.config.global.set(`${kind}.${name}.enabled`, enabled);
}
