/**
 * token-utils — Token 计数工具。
 *
 * 从 session.ts 中提取，避免 session 与 session-compactor 循环依赖。
 */

import type { AgentMessage } from '@aesyclaw/contracts/llm';

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
    const usage = (message as unknown as { usage?: { totalTokens?: number } }).usage;
    if (usage && typeof usage.totalTokens === 'number') {
      totalTokens += usage.totalTokens;
    }
  }
  return totalTokens;
}
