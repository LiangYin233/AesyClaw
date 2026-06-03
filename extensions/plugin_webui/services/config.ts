import type { PluginContext } from '@aesyclaw/sdk';

export function getConfig(ctx: PluginContext): Record<string, unknown> {
  return {
    server: ctx.config.global.get('server'),
    providers: ctx.config.global.get('providers'),
    channels: ctx.config.global.get('channels'),
    agent: ctx.config.global.get('agent'),
    mcp: ctx.config.global.get('mcp'),
    plugins: ctx.config.global.get('plugins'),
  };
}

export async function updateConfig(ctx: PluginContext, data: unknown): Promise<void> {
  if (!isRecord(data)) throw new Error('update_config 数据必须是对象');

  for (const [key, value] of Object.entries(data)) {
    if (key === 'server' || key === 'agent') {
      if (!isRecord(value)) throw new Error(`配置段 "${key}" 的 patch 值必须是对象`);
      const current = ctx.config.global.get(key);
      const base = isRecord(current) ? current : {};
      await ctx.config.global.set(key, mergeRecords(base, value));
      continue;
    }

    if (key === 'providers' || key === 'channels' || key === 'mcp' || key === 'plugins') {
      await ctx.config.global.set(key, value);
      continue;
    }

    throw new Error(`不支持的配置段 "${key}"`);
  }
}

function mergeRecords(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeRecords(current, value) : value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
