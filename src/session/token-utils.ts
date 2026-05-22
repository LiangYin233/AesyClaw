/**
 * token-utils — Token 估算工具。
 *
 * 从 session.ts 中提取，避免 session 与 session-compactor 循环依赖。
 */

import type { AgentMessage } from '@aesyclaw/contracts/llm';
import { extractMessageText } from '@aesyclaw/contracts/llm';

/**
 * 估算消息列表的 token 数（粗略估算，每字符约 0.25 个 token）。
 */
export function estimateApproximateTokens(messages: readonly AgentMessage[]): number {
  const textLength = messages.reduce(
    (total, message) => total + extractMessageText(message).length,
    0,
  );
  // Using 4 as divisor produces more predictable results than 3.5
  return Math.ceil(textLength / 4);
}
