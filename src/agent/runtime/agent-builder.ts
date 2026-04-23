/** @file pi-agent-core Agent 构建器
 *
 * 构建 Agent 实例，注入系统提示词、技能、角色列表和生命周期钩子。
 * 利用 pi-agent-core 原生 beforeToolCall 钩子做工具权限 block 校验，
 * 减少 AgentTool.execute 中的业务逻辑。
 */

import { Agent, type BeforeToolCallContext, type AgentMessage } from '@mariozechner/pi-agent-core';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import type { RoleCatalog } from '@/contracts/runtime-services.js';
import type { ProvidersConfig } from '@/features/config/schema.js';
import { buildHookSkills, buildHookTools } from '@/features/plugins/hook-utils.js';
import { SUBAGENT_TOOL_NAME_RUN } from '@/agent/subagent/types.js';
import { type LLMConfig } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import type { Tool, ToolExecutionResult, ToolExecuteContext } from '@/platform/tools/types.js';
import { buildModel } from './model-builder.js';
import { toAgentTool, type PiRunStats } from './agent-tool-adapter.js';

/** 构建角色列表提示词注入 */
function buildRolesPromptSection(tools: readonly Tool[], roleCatalog?: RoleCatalog): string | null {
    if (!tools.some((tool) => tool.name === SUBAGENT_TOOL_NAME_RUN)) {
        return null;
    }

    const roles = roleCatalog?.getRolesList() ?? [];
    if (roles.length === 0) {
        return null;
    }

    const listing = roles
        .map(
            (role) =>
                `- ${role.id}: ${role.name}${role.description ? ` - ${role.description}` : ''}`,
        )
        .join('\n');

    return [
        'Available roles:',
        listing,
        'If a task matches one of these roles, call `runSubAgent` with one of the listed role IDs only.',
    ].join('\n');
}

export interface BuildPiAgentOptions {
    chatId: string;
    llmConfig: LLMConfig;
    providers?: ProvidersConfig;
    systemPrompt: string;
    maxSteps: number;
    filteredTools: Tool[];
    allowedSkills: Array<{ name: string; description: string; content: string }>;
    messages: AgentMessage[];
    stats: PiRunStats;
    hookRuntime: PluginHookRuntime;
    send?: ToolExecuteContext['send'];
    checkToolAllowed?: (_tool: Tool) => ToolExecutionResult | null;
    getRoleId?: () => string;
    roleCatalog?: RoleCatalog;
    senderId?: string;
}

/** 构建 pi-agent-core Agent 实例 */
export function buildPiAgent(options: BuildPiAgentOptions): Agent {
    const toolDefs = options.filteredTools.map((tool) => tool.getDefinition());
    const hookSkills = buildHookSkills(
        options.allowedSkills.map((s) => ({
            name: s.name,
            description: s.description,
            metadata: {},
            content: s.content,
        })),
    );
    const hookTools = buildHookTools(
        toolDefs,
        options.allowedSkills.map((s) => ({
            name: s.name,
            description: s.description,
            metadata: {},
            content: s.content,
        })),
    );

    const model = buildModel(options.llmConfig, options.providers);
    const getRoleId = options.getRoleId ?? (() => '');
    const roleId = getRoleId();

    // 构建 systemPrompt（注入技能和角色列表）
    const skillTexts = options.allowedSkills
        .map((skill) => `## ${skill.name}\n${skill.content}`)
        .join('\n\n');

    const rolesSection = buildRolesPromptSection(options.filteredTools, options.roleCatalog);

    const fullSystemPrompt = [
        options.systemPrompt,
        skillTexts ? `\n\n${skillTexts}` : '',
        rolesSection ? `\n\n${rolesSection}` : '',
    ]
        .filter(Boolean)
        .join('');

    // beforeLLMRequest 钩子
    const runBeforeLLMHook = async (): Promise<void> => {
        options.stats.steps += 1;

        const beforeLLMResult = await options.hookRuntime.dispatchBeforeLLMRequest({
            messages: agent.state.messages,
            tools: hookTools,
            skills: hookSkills,
        });

        if (beforeLLMResult.blocked) {
            throw new Error(beforeLLMResult.reason || 'LLM request blocked by plugin hook');
        }
    };

    // 工具索引，用于原生 beforeToolCall 钩子中的权限校验
    const toolIndex = new Map(options.filteredTools.map((tool) => [tool.name, tool] as const));

    const agent = new Agent({
        initialState: {
            systemPrompt: fullSystemPrompt,
            model,
            tools: options.filteredTools.map((tool) =>
                toAgentTool(tool, {
                    chatId: options.chatId,
                    roleId,
                    allowedTools: options.filteredTools.map((t) => t.name),
                    allowedSkills: options.allowedSkills.map((s) => s.name),
                    send: options.send,
                    hookRuntime: options.hookRuntime,
                    stats: options.stats,
                    senderId: options.senderId,
                }),
            ),
            messages: options.messages,
        },
        getApiKey: () => options.llmConfig.apiKey,
        beforeToolCall: async (ctx: BeforeToolCallContext) => {
            const tool = toolIndex.get(ctx.toolCall.name);
            if (!tool || !options.checkToolAllowed) {
                return;
            }

            const rejectedResult = options.checkToolAllowed(tool);
            if (rejectedResult) {
                logger.info(
                    {
                        toolName: tool.name,
                        toolCallId: ctx.toolCall.id,
                        success: rejectedResult.success,
                        error: rejectedResult.error,
                    },
                    'Tool call rejected before execution',
                );
                return { block: true, reason: rejectedResult.error || 'Tool call rejected' };
            }
        },
    });

    // pi-agent-core 没有直接的 beforeLLMRequest 钩子，
    // 通过订阅 turn_start 事件来模拟。
    agent.subscribe(async (event) => {
        if (event.type === 'turn_start') {
            try {
                await runBeforeLLMHook();
            } catch (error) {
                options.stats.error = toErrorMessage(error);
                throw error;
            }
        }
    });

    return agent;
}
