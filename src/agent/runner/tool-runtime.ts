/**
 * runner/tool-runtime — Agent 运行时的工具适配层。
 *
 * 负责将 AgentTool 适配为 PiAgent 工具格式，预算限制等。
 */

import type { AgentTool, AgentToolResult, AgentMessage } from '../types';
import type { AfterToolCallContext, AfterToolCallResult } from '@mariozechner/pi-agent-core';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('tool-runtime');

type PiAgentToolAdapter = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
};

class AgentRunCancelledError extends Error {
  constructor() {
    super('Agent 处理已中止');
  }
}

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
      throwIfCancelled(signal);
      throwIfCancelled(toolSignal);

      const result = await tool.execute(toolCallId, params, toolSignal);

      throwIfCancelled(signal);
      throwIfCancelled(toolSignal);

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
): { maxToolResultTokens: number; maxToolResultChars: number } {
  const compressionLimitTokens = Math.floor(model.contextWindow * compressionThreshold);
  const historyTextLength = history.reduce(
    (total, message) => total + extractMessageText(message).length,
    0,
  );
  const usedTokens = Math.ceil(historyTextLength / 3.5) + Math.ceil(content.length / 3.5);
  const remainingTokens = Math.max(0, compressionLimitTokens - usedTokens);
  const maxToolResultTokens = Math.floor(remainingTokens * 0.5);
  return {
    maxToolResultTokens,
    maxToolResultChars: Math.floor(maxToolResultTokens * 3.5),
  };
}

function extractMessageText(message: AgentMessage): string {
  if (message.role === 'user') {
    return typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('');
  }
  if (message.role === 'assistant' || message.role === 'toolResult') {
    return message.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
  }
  return '';
}

export function limitToolResultContent<T extends AgentToolResult>(
  result: T,
  budget: { maxToolResultTokens: number; maxToolResultChars: number },
): T {
  const originalContentLength = result.content.reduce(
    (total, block) => total + block.text.length,
    0,
  );
  if (originalContentLength <= budget.maxToolResultChars) return result;

  let remainingChars = budget.maxToolResultChars;
  const content = result.content.map((block) => {
    const text = block.text.slice(0, Math.max(0, remainingChars));
    remainingChars -= text.length;
    return { ...block, text };
  });

  return {
    ...result,
    content,
    details: {
      ...(isPlainRecord(result.details) ? result.details : {}),
      truncated: true,
      originalContentLength,
      truncatedContentLength: content.reduce((total, block) => total + block.text.length, 0),
      maxToolResultTokens: budget.maxToolResultTokens,
    },
  };
}




export function createToolResultBudgetHandler(toolResultBudget: {
  maxToolResultTokens: number;
  maxToolResultChars: number;
}): (
  context: AfterToolCallContext,
  signal?: AbortSignal,
) => Promise<AfterToolCallResult | undefined> {
  return async (context, signal) => {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new AgentRunCancelledError();
    }

    const result = context.result as AgentToolResult;
    if (context.isError || result.isError) return undefined;

    const limited = limitToolResultContent(result, toolResultBudget);
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

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new AgentRunCancelledError();
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
