/**
 * token-utils — Token 估算工具。
 *
 * 从 session.ts 中提取，避免 session 与 session-compactor 循环依赖。
 */

import type { AgentMessage } from '@aesyclaw/contracts/llm';
import { extractMessageText } from '@aesyclaw/contracts/llm';


/**
 * 估算消息列表的 token 数（粗略估算，每字符约 0.25 个 token）。
 * 包括文本内容以及工具调用的 JSON 参数。
 */
export function estimateApproximateTokens(messages: readonly AgentMessage[]): number {
  let textLength = 0;
  for (const message of messages) {
    textLength += extractMessageText(message).length;
    // 额外计算工具调用的 JSON 参数长度（extractMessageText 会过滤掉 ToolCall 块）
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content as unknown as Array<Record<string, unknown>>) {
        if (block['type'] === 'toolCall') {
          textLength += JSON.stringify(block['arguments'] ?? {}).length;
        }
      }
    }
  }
  // 与 tool-runtime.ts 保持一致的经验系数
  return Math.ceil(textLength / 3.5);
}
