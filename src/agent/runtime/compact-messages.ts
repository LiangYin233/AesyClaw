/** @file 消息压缩
 *
 * 提供手动压缩会话历史消息的功能。
 * 使用 pi-ai 的 completeSimple 生成对话摘要。
 */

import { completeSimple } from '@mariozechner/pi-ai';

import { type LLMConfig } from '@/platform/llm/types.js';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { buildModel } from './model-builder.js';

/** 手动压缩消息
 *
 * 将历史消息通过 LLM 压缩为摘要，保留关键信息。
 */
/** 从 AgentMessage 中提取可读的文本内容 */
function extractMessageText(message: AgentMessage): string {
    if (message.role === 'user') {
        return typeof message.content === 'string' ? message.content : '';
    }
    if (message.role === 'assistant') {
        return message.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text)
            .join('');
    }
    if (message.role === 'toolResult') {
        return message.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text)
            .join('');
    }
    return '';
}

export async function manuallyCompactMessages(options: {
    chatId: string;
    llmConfig: LLMConfig;
    messages: AgentMessage[];
}): Promise<AgentMessage[]> {
    const historyMessages = options.messages;

    if (historyMessages.length <= 2) {
        return options.messages;
    }

    const historyText = historyMessages
        .map((m) => {
            const role = m.role === 'toolResult' ? 'tool' : m.role;
            return `${role}: ${extractMessageText(m)}`;
        })
        .join('\n\n');

    const model = buildModel(options.llmConfig);

    try {
        const result = await completeSimple(
            model,
            {
                systemPrompt:
                    '你是一个对话摘要助手。请将用户提供的对话历史压缩成一段简洁的中文摘要，保留所有关键信息、决策和事实。',
                messages: [
                    {
                        role: 'user',
                        content: `请将以下对话历史压缩成摘要：\n\n${historyText}`,
                        timestamp: Date.now(),
                    },
                ],
            },
            {
                apiKey: options.llmConfig.apiKey,
            },
        );

        const summaryText = result.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text)
            .join('');

        logger.info(
            { chatId: options.chatId, originalCount: options.messages.length },
            'Messages compacted',
        );

        return [
            {
                role: 'user',
                content: `[历史会话摘要]\n${summaryText}`,
                timestamp: Date.now(),
            },
        ];
    } catch (error) {
        logger.error(
            { chatId: options.chatId, error: toErrorMessage(error) },
            'Failed to compact messages, returning original',
        );
        return options.messages;
    }
}
