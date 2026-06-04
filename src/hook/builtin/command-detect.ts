/**
 * command-detect — 命令检测中间件。
 *
 * 在 pipeline:receive 链中检测并执行斜杠命令。
 * 如果检测到命令，执行后短路（不继续后续流程）。
 */
import type { HookRegistration, Middleware, HookResult, HookCtx } from '@aesyclaw/hook';
import { getMessageText } from '@aesyclaw/core/types';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';

const COMMAND_DETECT_HOOK_ID = 'core:command-detect';

function createCommandDetectMiddleware(commandRegistry: CommandRegistry): Middleware {
  return async (ctx: HookCtx, next?: () => Promise<HookResult>): Promise<HookResult> => {
    const text = getMessageText(ctx.message);
    const resolved = commandRegistry.resolve(text);

    // 如果不是命令，继续后续流程
    if (!resolved) {
      return next !== undefined ? await next() : { action: 'next' };
    }

    // 如果是命令，检查是否允许在 Agent 处理期间执行
    if (ctx.session?.isLocked && !resolved.command.allowDuringAgentProcessing) {
      return {
        action: 'respond',
        message: {
          components: [{ type: 'Plain', text: 'Agent 正在处理中，请稍后再试。' }],
        },
      };
    }

    // 执行命令
    try {
      const result = await commandRegistry.executeResolved(resolved, {
        sessionKey: ctx.sessionKey,
      });
      return { action: 'respond', message: result };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { action: 'error', reason };
    }
  };
}

export function createCommandDetectHook(commandRegistry: CommandRegistry): HookRegistration {
  return {
    id: COMMAND_DETECT_HOOK_ID,
    chain: 'pipeline:receive',
    priority: 10, // 高优先级，在其他 Hook 之前执行
    handler: createCommandDetectMiddleware(commandRegistry),
  };
}

export { COMMAND_DETECT_HOOK_ID };
