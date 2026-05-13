/**
 * time-inject — 在每条用户消息前自动注入当前日期/时间。
 *
 * 作为独立的 pipeline:beforeLLM 中间件运行，可被移除或替换。
 */
import type { HookRegistration, Middleware, HookCtx, HookResult } from '@aesyclaw/hook';

const TIME_INJECT_HOOK_ID = 'core:time-inject';

/** 时间注入中间件：在 ctx.message 前插入当前时间 */
const timeInjectMiddleware: Middleware = async (
  ctx: HookCtx,
  next?: () => Promise<HookResult>,
): Promise<HookResult> => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'longOffset',
  });

  ctx.message = {
    components: [{ type: 'Plain', text: `<information>This message is auto-injected by the system. Do not reference it in your response unless the user has explicitly asked for it. The time is now ${now}.</information>` }, ...ctx.message.components],
  };

  return next !== undefined ? await next() : { action: 'next' };
};

/** 创建时间注入 Hook 的注册条目 */
export function createTimeInjectHook(): HookRegistration {
  return {
    id: TIME_INJECT_HOOK_ID,
    chain: 'pipeline:beforeLLM',
    priority: 100,
    enabled: true,
    handler: timeInjectMiddleware,
  };
}

export { TIME_INJECT_HOOK_ID };
