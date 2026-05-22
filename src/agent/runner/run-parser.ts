/**
 * runner/run-parser — Agent 运行结果解析。
 *
 * 负责从 AgentMessage 列表中提取最终的助手回复文本、用量等信息。
 */

import type { AgentMessage } from '../types';
import type { StreamUsage } from '@aesyclaw/core/stream-types';
import { assistantHasToolCalls } from '@aesyclaw/contracts/llm';

export function createAgentRunResult(
  newMessages: readonly AgentMessage[],
): { newMessages: AgentMessage[]; lastAssistant: string | null; cancelled: boolean } {
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

export function getFinalAssistantMeta(
  messages: readonly AgentMessage[],
): Record<string, unknown> {
  const finalAssistant = findFinalAssistant(messages);
  if (!finalAssistant) return { lastAssistantRole: null };
  const record = finalAssistant as unknown as Record<string, unknown>;
  return {
    lastAssistantRole: finalAssistant.role,
    lastAssistantStopReason: record['stopReason'],
    lastAssistantErrorMessage: record['errorMessage'],
    lastAssistantTextLength: extractAssistantText(finalAssistant).length,
  };
}

export function getFinalAssistantUsage(
  messages: readonly AgentMessage[],
): StreamUsage | undefined {
  const finalAssistant = findFinalAssistant(messages);
  if (!finalAssistant || assistantHasToolCalls(finalAssistant)) return undefined;
  const usage = (finalAssistant as unknown as { usage?: unknown }).usage;
  if (!isPlainRecord(usage)) return undefined;

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

  const result: StreamUsage = { input, output, cacheRead, cacheWrite, totalTokens };
  const cost = usage['cost'];
  if (isPlainRecord(cost)) {
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
  for (const message of [...messages].reverse()) {
    if (message.role === 'assistant') return message;
  }
  return null;
}

function getAssistantErrorMessage(message: AgentMessage): string | null {
  if (message.role !== 'assistant') return null;
  const record = message as unknown as Record<string, unknown>;
  if (record['stopReason'] !== 'error') return null;
  return typeof record['errorMessage'] === 'string' && record['errorMessage'].trim().length > 0
    ? record['errorMessage'].trim()
    : '模型调用失败但未返回错误详情';
}

function extractAssistantText(message: AgentMessage): string {
  if (message.role !== 'assistant') return '';
  return message.content
    .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
    .map((content) => content.text)
    .join('\n');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
