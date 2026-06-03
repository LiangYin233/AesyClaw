import type { PluginContext } from '@aesyclaw/sdk';

export function getSessions(ctx: PluginContext): ReturnType<PluginContext['control']['sessions']['list']> {
  return ctx.control.sessions.list();
}

export function getSessionMessages(
  ctx: PluginContext,
  sessionId: string,
): ReturnType<PluginContext['control']['sessions']['getMessages']> {
  return ctx.control.sessions.getMessages(sessionId);
}

export function clearSessionHistory(
  ctx: PluginContext,
  sessionId: string,
): ReturnType<PluginContext['control']['sessions']['clear']> {
  return ctx.control.sessions.clear(sessionId);
}
