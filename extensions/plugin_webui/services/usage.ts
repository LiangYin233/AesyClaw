import type { PluginContext } from '@aesyclaw/sdk';

export function getUsage(
  ctx: PluginContext,
  options?: { model?: string; from?: string; to?: string },
): ReturnType<PluginContext['control']['usage']['query']> {
  return ctx.control.usage.query(options);
}

export function getUsageToday(
  ctx: PluginContext,
): ReturnType<PluginContext['control']['usage']['today']> {
  return ctx.control.usage.today();
}

export function getUsageTools(
  ctx: PluginContext,
  options?: { from?: string; to?: string },
): ReturnType<PluginContext['control']['usage']['tools']> {
  return ctx.control.usage.tools(options);
}
