import type { PluginContext } from '@aesyclaw/sdk';

export function getConfig(ctx: PluginContext): Record<string, unknown> {
  return {
    providers: ctx.config.global.get('providers'),
    channels: ctx.config.global.get('channels'),
    agent: ctx.config.global.get('agent'),
    mcp: ctx.config.global.get('mcp'),
    plugins: ctx.config.global.get('plugins'),
  };
}

export async function updateConfig(ctx: PluginContext, data: unknown): Promise<void> {
  if (!isRecord(data)) throw new Error('update_config 数据必须是对象');
  await ctx.config.global.update(data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
