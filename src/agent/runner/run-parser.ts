/**
 * runner/run-parser — Agent 运行结果解析。
 *
 * 负责从 AgentMessage 列表中提取最终的助手回复文本、用量等信息。
 */

import type { AgentMessage } from '../types';
import type { MessageUsage } from '@aesyclaw/core/types';
import { assistantHasToolCalls } from '@aesyclaw/contracts/llm';
import { isRecord } from '@aesyclaw/core/utils';

/**
 * AgentMessage 的扩展类型，包含运行时可能存在的额外字段。
 */
type AgentMessageWithMeta = AgentMessage & {
  stopReason?: string;
  errorMessage?: string;
  usage?: unknown;
};

/**
 * 类型守卫：检查 AgentMessage 是否包含元数据字段。
 */
function hasMessageMeta(message: AgentMessage): message is AgentMessageWithMeta {
  return typeof message === 'object' && message !== null;
}

/**
 * 安全地从 AgentMessage 中提取字符串字段。
 */
function getStringField(message: AgentMessage, field: string): string | undefined {
  if (!hasMessageMeta(message)) return undefined;
  const value = (message as unknown as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * 安全地从 AgentMessage 中提取 usage 字段。
 */
function getUsageField(message: AgentMessage): Record<string, unknown> | undefined {
  if (!hasMessageMeta(message)) return undefined;
  const meta = message as AgentMessageWithMeta;
  return isRecord(meta.usage) ? meta.usage : undefined;
}

export function createAgentRunResult(newMessages: readonly AgentMessage[]): {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
  cancelled: boolean;
} {
  return {
    newMessages: [...newMessages],
    lastAssistant: resolveLastAssistant(newMessages),
    cancelled: false,
  };
}

export function createCancelledRunResult(): {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
  cancelled: boolean;
} {
  return { newMessages: [], lastAssistant: null, cancelled: true };
}

export function getFinalAssistantMeta(messages: readonly AgentMessage[]): Record<string, unknown> {
  const finalAssistant = findFinalAssistant(messages);
  if (!finalAssistant) return { lastAssistantRole: null };
  return {
    lastAssistantRole: finalAssistant.role,
    lastAssistantStopReason: getStringField(finalAssistant, 'stopReason'),
    lastAssistantErrorMessage: getStringField(finalAssistant, 'errorMessage'),
    lastAssistantTextLength: extractAssistantText(finalAssistant).length,
  };
}

export function getFinalAssistantUsage(
  messages: readonly AgentMessage[],
): MessageUsage | undefined {
  const finalAssistant = findFinalAssistant(messages);
  if (!finalAssistant || assistantHasToolCalls(finalAssistant)) return undefined;
  const usage = getUsageField(finalAssistant);
  if (!usage) return undefined;

  const input = numberField(usage, 'input');
  const output = numberField(usage, 'output');
  const cacheRead = numberField(usage, 'cacheRead');
  const cacheWrite = numberField(usage, 'cacheWrite');
  const totalTokens = numberField(usage, 'totalTokens');
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    totalTokens === undefined
  ) {
    return undefined;
  }

  const result: MessageUsage = { input, output, cacheRead, cacheWrite, totalTokens };
  const cost = usage['cost'];
  if (isRecord(cost)) {
    const inputCost = numberField(cost, 'input');
    const outputCost = numberField(cost, 'output');
    const cacheReadCost = numberField(cost, 'cacheRead');
    const cacheWriteCost = numberField(cost, 'cacheWrite');
    const totalCost = numberField(cost, 'total');
    if (
      inputCost !== undefined &&
      outputCost !== undefined &&
      cacheReadCost !== undefined &&
      cacheWriteCost !== undefined &&
      totalCost !== undefined
    ) {
      result.cost = {
        input: inputCost,
        output: outputCost,
        cacheRead: cacheReadCost,
        cacheWrite: cacheWriteCost,
        total: totalCost,
      };
    }
  }
  return result;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveLastAssistant(newMessages: readonly AgentMessage[]): string | null {
  const finalAssistant = findFinalAssistant(newMessages);
  if (!finalAssistant) return null;

  const errorMessage = getAssistantErrorMessage(finalAssistant);
  if (errorMessage) return `[模型错误: ${errorMessage}]`;

  const text = extractAssistantText(finalAssistant).trim();
  return text.length > 0 ? text : null;
}

function findFinalAssistant(messages: readonly AgentMessage[]): AgentMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && message.role === 'assistant') return message;
  }
  return null;
}

function getAssistantErrorMessage(message: AgentMessage): string | null {
  if (message.role !== 'assistant') return null;
  const stopReason = getStringField(message, 'stopReason');
  if (stopReason !== 'error') return null;
  const errorMessage = getStringField(message, 'errorMessage');
  return errorMessage && errorMessage.trim().length > 0
    ? errorMessage.trim()
    : '模型调用失败但未返回错误详情';
}

function extractAssistantText(message: AgentMessage): string {
  if (message.role !== 'assistant') return '';
  return message.content
    .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
    .map((content) => content.text)
    .join('\n');
}
