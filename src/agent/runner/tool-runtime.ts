/**
 * runner/tool-runtime — Agent 运行时的工具适配层。
 *
 * 负责将 AgentTool 适配为 PiAgent 工具格式，预算限制等。
 */

import type { AgentTool, AgentToolResult, AgentMessage } from '../types';
import type { AfterToolCallContext, AfterToolCallResult } from '@earendil-works/pi-agent-core';
import type { IHooksBus, ToolResultBudget } from '@aesyclaw/hook';
import type { SessionKey } from '@aesyclaw/core/types';
import {
  CHARS_PER_TOKEN,
  calculateEstimatedContextTokens,
} from '@aesyclaw/session/utils/token-utils';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { throwIfCancelled } from './shared';
const logger = createScopedLogger('tool-runtime');

/** 工具结果可使用的剩余 token 预算比例 */
const TOOL_RESULT_BUDGET_RATIO = 0.5;

type PiAgentToolAdapter = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
};

export function adaptToolForPiAgent(tool: AgentTool, signal: AbortSignal): PiAgentToolAdapter {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (
      toolCallId: string,
      params: unknown,
      piSignal?: AbortSignal,
    ): Promise<AgentToolResult> => {
      const toolSignal = piSignal ?? signal;
      throwIfCancelled(toolSignal);

      const result = await tool.execute(toolCallId, params, toolSignal);

      if (result.isError) {
        const errorContent = result.content.map((content) => content.text).join('\n');
        logger.error('工具调用返回错误', { toolName: tool.name, error: errorContent });
      }

      return result;
    },
  };
}

export function calculateToolResultBudget(
  model: { contextWindow: number },
  compressionThreshold: number,
  history: readonly AgentMessage[],
  content: string,
): ToolResultBudget {
  const compressionLimitTokens = Math.floor(model.contextWindow * compressionThreshold);

  const usedTokens = calculateEstimatedContextTokens(history, content);

  const remainingTokens = Math.max(0, compressionLimitTokens - usedTokens);
  const maxToolResultTokens = Math.floor(remainingTokens * TOOL_RESULT_BUDGET_RATIO);
  return {
    maxToolResultTokens,
    maxToolResultChars: Math.floor(maxToolResultTokens * CHARS_PER_TOKEN),
  };
}

export function createToolResultBudgetHandler(
  toolResultBudget: ToolResultBudget,
  hooksBus: IHooksBus,
  sessionKey: SessionKey,
): (
  context: AfterToolCallContext,
  signal?: AbortSignal,
) => Promise<AfterToolCallResult | undefined> {
  return async (context) => {
    const result = context.result as AgentToolResult;
    const ctx = {
      message: { components: [] },
      sessionKey,
      agentToolResult: result,
      toolResultBudget,
    };

    const hookResult = await hooksBus.dispatch('agent:afterToolCall', ctx);
    if (hookResult.action === 'error') {
      logger.error('agent:afterToolCall 钩子执行错误', hookResult.reason);
      return undefined;
    }

    const limited = ctx.agentToolResult;
    if (limited === result) return undefined;

    const override: AfterToolCallResult = {
      content: limited.content,
      details: limited.details,
    };
    if (limited.isError !== undefined) override.isError = limited.isError;
    if (limited.terminate !== undefined) override.terminate = limited.terminate;
    return override;
  };
}
