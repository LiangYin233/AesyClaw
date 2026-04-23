/** @file AgentMessage 工具函数
 *
 * 从 AgentMessage 列表中提取文本内容、统计 token 用量。
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';

/** 从消息列表中提取最后一条非工具调用的助手回复 */
export function getFinalAssistantText(messages: readonly AgentMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.role === 'assistant') {
            const textParts = message.content
                .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                .map((c) => c.text);
            const text = textParts.join('');
            const hasToolCalls = message.content.some((c) => c.type === 'toolCall');
            if (!hasToolCalls && text) {
                return text;
            }
        }
    }

    return '';
}

/** 收集 Agent 执行的总 token 使用量 */
export function collectTokenUsage(messages: readonly AgentMessage[]):
    | {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
      }
    | undefined {
    let totalInput = 0;
    let totalOutput = 0;
    let hasUsage = false;

    for (const message of messages) {
        if (message.role === 'assistant' && message.usage) {
            totalInput += message.usage.input;
            totalOutput += message.usage.output;
            hasUsage = true;
        }
    }

    if (!hasUsage) {
        return undefined;
    }

    return {
        promptTokens: totalInput,
        completionTokens: totalOutput,
        totalTokens: totalInput + totalOutput,
    };
}
