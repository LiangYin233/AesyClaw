import type { PluginContext } from '@aesyclaw/sdk';

export function getStatus(ctx: PluginContext): ReturnType<PluginContext['control']['status']['get']> {
  return ctx.control.status.get();
}
