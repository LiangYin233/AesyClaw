/**
 * user-input-budget-guard — 在进入 Agent 前拒绝过长的用户输入。
 *
 * 当前消息内容本身超过模型上下文窗口时，压缩历史无法解决问题。
 * 这个 Hook 在 pipeline:beforeAgent 阶段最后运行，直接回复用户，并记录 warn 日志。
 */
import type { AgentMessage } from '@aesyclaw/contracts/llm';
import { getMessageText } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { HookCtx, HookRegistration, HookResult, Middleware } from '@aesyclaw/hook';
import { calculateEstimatedContextTokens, estimateTextTokens } from '@aesyclaw/session';

export const USER_INPUT_BUDGET_GUARD_HOOK_ID = 'core:user-input-budget-guard';

const USER_INPUT_TOO_LONG_MESSAGE =
  '输入内容本身超过当前模型上下文限制，已停止本次处理。请减少输入长度后再试。';

const logger = createScopedLogger('user-input-budget');

type ContextBudget = {
  limitTokens: number;
  historyTokens: number;
  currentTokens: number;
  totalTokens: number;
  availableTokens: number;
  currentExceedsModelWindow: boolean;
};

export function createUserInputBudgetGuardHook(): HookRegistration {
  return {
    id: USER_INPUT_BUDGET_GUARD_HOOK_ID,
    chain: 'pipeline:beforeAgent',
    priority: Number.MAX_SAFE_INTEGER,
    handler: createUserInputBudgetGuardMiddleware(),
  };
}

function createUserInputBudgetGuardMiddleware(): Middleware {
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
    });

    if (!budget.currentExceedsModelWindow) {
      return next !== undefined ? await next() : { action: 'next' };
    }

    logger.warn('用户输入本身超过模型上下文窗口，已拒绝处理', {
      sessionKey: ctx.sessionKey,
      modelId: ctx.agent?.modelIdentifier,
      contextWindow: model.contextWindow,
      limitTokens: budget.limitTokens,
      historyTokens: budget.historyTokens,
      availableTokens: budget.availableTokens,
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
}): ContextBudget {
  const limitTokens = Math.floor(params.contextWindow);
  const historyTokens = calculateEstimatedContextTokens(params.history);
  const currentTokens = estimateTextTokens(params.currentContent);
  const totalTokens = historyTokens + currentTokens;
  const availableTokens = Math.max(0, limitTokens - historyTokens);

  return {
    limitTokens,
    historyTokens,
    currentTokens,
    totalTokens,
    availableTokens,
    currentExceedsModelWindow: currentTokens > 0 && currentTokens >= limitTokens,
  };
}
