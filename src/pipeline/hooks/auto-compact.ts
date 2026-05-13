/**
 * auto-compact — 在 LLM 调用前自动压缩超限的会话历史。
 *
 * 替代 Agent.loadHistory() 中的硬编码 shouldCompact 逻辑。
 * 作为 pipeline:beforeLLM 中间件运行，可被禁用或替换。
 */
import type { Middleware, HookRegistration, HookResult, HookCtx } from '@aesyclaw/hook';
import { estimateApproximateTokens } from '@aesyclaw/session';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';

const AUTO_COMPACT_HOOK_ID = 'core:auto-compact';

function createAutoCompactMiddleware(
  llmAdapter: LlmAdapter,
  compressionThreshold: number,
): Middleware {
  return async (ctx: HookCtx, next?: () => Promise<HookResult>): Promise<HookResult> => {
    if (!ctx.session || !ctx.role) {
      return next !== undefined ? await next() : { action: 'next' };
    }

    const history = ctx.session.get();
    const model = ctx.agent?.model;
    if (!model) {
      return next !== undefined ? await next() : { action: 'next' };
    }

    if (estimateApproximateTokens(history) >= model.contextWindow * compressionThreshold) {
      await ctx.session.compact(llmAdapter, ctx.role.model);
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
    chain: 'pipeline:beforeLLM',
    priority: 50, // run before time-inject (100)
    enabled: true,
    handler: createAutoCompactMiddleware(llmAdapter, compressionThreshold),
  };
}

export { AUTO_COMPACT_HOOK_ID };
