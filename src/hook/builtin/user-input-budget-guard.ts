/**
 * user-input-budget-guard — 在进入 Agent 前拒绝过长的用户输入。
 *
 * 当前用户输入本身超过上下文预算时，压缩历史无法解决问题。
 * 这个 Hook 在 pipeline:beforeAgent 阶段直接回复用户，并记录 warn 日志。
 */
import type { AgentMessage } from '@aesyclaw/contracts/llm';
import { getMessageText } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { HookCtx, HookRegistration, HookResult, Middleware } from '@aesyclaw/hook';
import { calculateEstimatedContextTokens, estimateTextTokens } from '@aesyclaw/session';

export const USER_INPUT_BUDGET_GUARD_HOOK_ID = 'core:user-input-budget-guard';

const USER_INPUT_TOO_LONG_MESSAGE =
  '输入内容超过当前上下文限制，已停止本次处理。请减少输入长度或手动压缩会话后再试。';

const logger = createScopedLogger('user-input-budget');

type ContextBudget = {
  limitTokens: number;
  historyTokens: number;
  currentTokens: number;
  totalTokens: number;
  currentExceedsLimit: boolean;
};

export function createUserInputBudgetGuardHook(compressionThreshold: number): HookRegistration {
  return {
    id: USER_INPUT_BUDGET_GUARD_HOOK_ID,
    chain: 'pipeline:beforeAgent',
    priority: 90,
    enabled: true,
    handler: createUserInputBudgetGuardMiddleware(compressionThreshold),
  };
}

function createUserInputBudgetGuardMiddleware(compressionThreshold: number): Middleware {
  return async (ctx: HookCtx, next?: () => Promise<HookResult>): Promise<HookResult> => {
    const model = ctx.agent?.model;
    if (!ctx.session || !model) {
      return next !== undefined ? await next() : { action: 'next' };
    }

    const currentContent = getMessageText(ctx.message);
    const budget = calculateContextBudget({
      history: ctx.session.get(),
      currentContent,
      contextWindow: model.contextWindow,
      compressionThreshold,
    });

    if (!budget.currentExceedsLimit) {
      return next !== undefined ? await next() : { action: 'next' };
    }

    logger.warn('用户输入超过上下文预算，已拒绝处理', {
      sessionKey: ctx.sessionKey,
      modelId: ctx.agent?.modelIdentifier,
      contextWindow: model.contextWindow,
      limitTokens: budget.limitTokens,
      historyTokens: budget.historyTokens,
      currentTokens: budget.currentTokens,
      totalTokens: budget.totalTokens,
      currentChars: currentContent.length,
    });

    return {
      action: 'respond',
      message: { components: [{ type: 'Plain', text: USER_INPUT_TOO_LONG_MESSAGE }] },
    };
  };
}

function calculateContextBudget(params: {
  history: readonly AgentMessage[];
  currentContent: string;
  contextWindow: number;
  compressionThreshold: number;
}): ContextBudget {
  const limitTokens = Math.floor(params.contextWindow * params.compressionThreshold);
  const historyTokens = calculateEstimatedContextTokens(params.history);
  const currentTokens = estimateTextTokens(params.currentContent);
  const totalTokens = historyTokens + currentTokens;

  return {
    limitTokens,
    historyTokens,
    currentTokens,
    totalTokens,
    currentExceedsLimit: currentTokens >= limitTokens,
  };
}
