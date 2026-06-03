import type { PluginContext } from '@aesyclaw/sdk';

export function getLogs(
  ctx: PluginContext,
  options?: { limit?: number },
): ReturnType<PluginContext['control']['logs']['query']> {
  return ctx.control.logs.query(options);
}
