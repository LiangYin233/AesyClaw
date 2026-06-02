/**
 * auto-compact — 在 LLM 调用前自动压缩超限的会话历史。
 *
 * 替代 Agent.loadHistory() 中的硬编码 shouldCompact 逻辑。
 * 作为 agent:beforeLLM 中间件运行，可被禁用或替换。
 */
import type { Middleware, HookRegistration, HookResult, HookCtx } from '@aesyclaw/hook';
import { getMessageText } from '@aesyclaw/core/types';
import { calculateEstimatedContextTokens } from '@aesyclaw/session';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';

const AUTO_COMPACT_HOOK_ID = 'core:auto-compact';

function createAutoCompactMiddleware(
  llmAdapter: LlmAdapter,
  compressionThreshold: number,
): Middleware {
  return async (ctx: HookCtx, next?: () => Promise<HookResult>): Promise<HookResult> => {
    if (!ctx.session || !ctx.role) {
      return next !== undefined ? await next() : { action: 'next' };
    }

    const sessionHistory = ctx.session.get();
    const history = ctx.llmHistory ?? [...sessionHistory];
    const model = ctx.agent?.model;
    if (!model) {
      return next !== undefined ? await next() : { action: 'next' };
    }

    const currentContent = ctx.llmContent ?? getMessageText(ctx.message);
    const estimatedTokens = calculateEstimatedContextTokens(history, currentContent);

    if (estimatedTokens >= model.contextWindow * compressionThreshold) {
      const transientHistory = history.slice(sessionHistory.length);
      await ctx.session.compact(llmAdapter, ctx.agent?.modelIdentifier ?? '');
      ctx.llmHistory = [...ctx.session.get(), ...transientHistory];
    }

    return next !== undefined ? await next() : { action: 'next' };
  };
}

export function createAutoCompactHook(
  llmAdapter: LlmAdapter,
  compressionThreshold: number,
): HookRegistration {
  return {
    id: AUTO_COMPACT_HOOK_ID,
    chain: 'agent:beforeLLM',
    priority: 50,
    enabled: true,
    handler: createAutoCompactMiddleware(llmAdapter, compressionThreshold),
  };
}

export { AUTO_COMPACT_HOOK_ID };
