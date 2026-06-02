/**
 * token-utils — Token 计数工具。
 *
 * 从 session.ts 中提取，避免 session 与 session-compactor 循环依赖。
 */

import { extractMessageText, type AgentMessage } from '@aesyclaw/contracts/llm';

/** 每个 token 的平均字符数（用于粗略估算）。 */
export const CHARS_PER_TOKEN = 3.5;

/**
 * 计算消息列表的实际 token 使用量（从 message.usage 累加）。
 * 这是准确的 token 计数，基于 LLM 返回的实际使用量。
 *
 * @param messages - 消息列表
 * @returns 实际 token 总数，如果没有 usage 信息则返回 0
 */
export function calculateActualTokens(messages: readonly AgentMessage[]): number {
  let totalTokens = 0;
  for (const message of messages) {
    const usage = getUsageTotalTokens(message);
    if (usage !== undefined) {
      totalTokens += usage;
    }
  }
  return totalTokens;
}

/**
 * 使用字符数粗略估算 token 数。
 *
 * 该估算仅用于上下文保护，不用于费用统计。
 */
export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * 估算单条消息的 token 数。
 *
 * 优先使用模型返回的真实 usage；缺失时从消息文本估算。
 */
export function calculateEstimatedMessageTokens(message: AgentMessage): number {
  const actual = getUsageTotalTokens(message);
  if (actual !== undefined) return actual;
  return estimateTextTokens(extractTextForEstimate(message));
}

/**
 * 估算下一次 LLM 调用前的上下文 token 数。
 *
 * 对历史消息使用「真实 usage 优先，缺失时估算」；当前输入尚未有 usage，始终估算。
 */
export function calculateEstimatedContextTokens(
  messages: readonly AgentMessage[],
  currentContent = '',
): number {
  const historyTokens = messages.reduce(
    (total, message) => total + calculateEstimatedMessageTokens(message),
    0,
  );
  return historyTokens + estimateTextTokens(currentContent);
}

function getUsageTotalTokens(message: AgentMessage): number | undefined {
  const usage = (message as unknown as { usage?: { totalTokens?: number } }).usage;
  if (!usage || typeof usage.totalTokens !== 'number') return undefined;
  if (!Number.isFinite(usage.totalTokens) || usage.totalTokens < 0) return undefined;
  return usage.totalTokens;
}

function extractTextForEstimate(message: AgentMessage): string {
  const content = (message as unknown as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (
          typeof block === 'object' &&
          block !== null &&
          'text' in block &&
          typeof block.text === 'string'
        ) {
          return block.text;
        }
        return '';
      })
      .join('');
  }

  try {
    return extractMessageText(message);
  } catch {
    return '';
  }
}
