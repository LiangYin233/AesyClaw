/** @file AesyClaw Tool → pi-agent-core AgentTool 适配器
 *
 * 提供工具执行的生命周期映射，保留插件 beforeToolCall/afterToolCall 钩子和统计能力。
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import { logger } from '@/platform/observability/logger.js';
import type { Tool, ToolExecuteContext, ToolExecutionResult } from '@/platform/tools/types.js';

/** Agent 运行统计 */
export interface PiRunStats {
    steps: number;
    toolCalls: number;
    error?: string;
}

const TOOL_LOG_CONTENT_LIMIT = 1000;

/** 截断工具执行日志内容，防止日志过大 */
function truncateToolLogContent(content: string): string {
    if (content.length <= TOOL_LOG_CONTENT_LIMIT) {
        return content;
    }

    return `${content.slice(0, TOOL_LOG_CONTENT_LIMIT)}...[truncated ${content.length - TOOL_LOG_CONTENT_LIMIT} chars]`;
}

export interface ToAgentToolOptions {
    chatId: string;
    roleId: string;
    allowedTools: string[];
    allowedSkills: string[];
    send?: ToolExecuteContext['send'];
    hookRuntime: PluginHookRuntime;
    stats: Pick<PiRunStats, 'toolCalls'>;
    senderId?: string;
}

/** 将 AesyClaw Tool 转换为 pi-agent-core AgentTool */
export function toAgentTool(tool: Tool, options: ToAgentToolOptions): AgentTool {
    return {
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: tool.parametersSchema,
        execute: async (toolCallId, params, _signal) => {
            options.stats.toolCalls += 1;

            logger.info(
                {
                    toolName: tool.name,
                    toolCallId,
                    chatId: options.chatId,
                    roleId: options.roleId,
                },
                'Starting tool execution',
            );

            const beforeToolResult = await options.hookRuntime.dispatchBeforeToolCall({
                id: toolCallId,
                name: tool.name,
                arguments: params as Record<string, unknown>,
            });

            let toolResult: ToolExecutionResult;

            if (beforeToolResult.shortCircuited) {
                toolResult = beforeToolResult.result;
                logger.info(
                    { toolName: tool.name, toolCallId, chatId: options.chatId },
                    'Tool execution short-circuited by hook',
                );
            } else {
                const context: ToolExecuteContext = {
                    chatId: options.chatId,
                    senderId: options.senderId || 'user',
                    roleId: options.roleId,
                    allowedTools: options.allowedTools,
                    allowedSkills: options.allowedSkills,
                    send: options.send,
                };
                toolResult = await tool.execute(params, context);
            }

            const finalResult = await options.hookRuntime.dispatchAfterToolCall({
                toolCall: {
                    id: toolCallId,
                    name: tool.name,
                    arguments: params as Record<string, unknown>,
                },
                result: toolResult,
            });

            logger.info(
                {
                    toolName: tool.name,
                    toolCallId,
                    chatId: options.chatId,
                    success: finalResult.success,
                    content: truncateToolLogContent(finalResult.content),
                    error: finalResult.error,
                    metadata: finalResult.metadata,
                },
                'Tool execution completed',
            );

            if (!finalResult.success) {
                throw new Error(finalResult.error || 'Tool execution failed');
            }

            return {
                content: [{ type: 'text', text: finalResult.content }],
                details: finalResult.metadata || {},
            };
        },
    };
}
