/** @file LLM Agent 引擎
 *
 * AgentEngine 是与 LLM 交互的核心引擎，负责：
 * - 管理会话记忆（SessionMemoryManager）
 * - 按角色权限过滤可用工具（getFilteredTools）
 * - 构建 aesyiu 运行时上下文并执行 LLM 请求
 * - 分发插件钩子（beforeLLMRequest / beforeToolCall / afterToolCall）
 * - 同步会话记忆与返回最终回复
 *
 * 典型调用流程：
 * 1. 通过 ChatService 创建 AgentEngine 实例
 * 2. 调用 run() 处理用户输入
 * 3. run() 内部：过滤工具 → 构建 aesyiu 引擎 → 执行 → 同步记忆 → 返回结果
 */

import { type AgentSkill, type Message as AesyiuMessage } from 'aesyiu';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import type { ConfigSource, RoleStore, SkillStore } from '@/contracts/runtime-services.js';
import { resolveLLMConfig } from '@/agent/runtime/resolve-llm-config.js';
import { LLMConfig, MessageRole } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import type { ToolCatalog } from '@/platform/tools/registry.js';
import { Tool, ToolExecuteContext, ToolExecutionResult } from '@/platform/tools/types.js';
import {
    buildAesyiuEngine,
    type AesyiuRunStats,
    getFinalAssistantText,
    inspectEngineToolParameters,
    toAesyiuMessage,
    toStandardMessage,
} from './runtime/aesyiu-runtime-helpers.js';
import { SessionMemoryManager } from './memory/session-memory-manager.js';
import { SessionMemoryConfig } from './memory/types.js';

/** Agent 运行时的可选参数 */
export interface AgentRunOptions {
    /** 向当前频道回发消息的回调 */
    send?: ToolExecuteContext['send'];
}

/** Agent 引擎配置 */
export interface AgentEngineConfig {
    /** LLM 模型配置（provider / model / temperature 等） */
    llm: LLMConfig;
    /** 最大 Agent 步数（防止无限循环） */
    maxSteps?: number;
    /** 系统提示词 */
    systemPrompt?: string;
    /** 外部传入的会话记忆管理器（为空时自动创建） */
    memory?: SessionMemoryManager;
    /** 仅允许使用的工具名称列表（为空时使用角色权限过滤） */
    tools?: string[];
    /** 会话记忆配置（上下文窗口大小、压缩阈值等） */
    memoryConfig?: Partial<SessionMemoryConfig>;
    /** 工具目录，用于查找与注册工具 */
    toolCatalog: ToolCatalog;
    /** 插件钩子运行时，分发 beforeLLMRequest / beforeToolCall / afterToolCall */
    hookRuntime: PluginHookRuntime;
    /** 配置源，获取 providers 等全局配置 */
    configSource: ConfigSource;
    /** 角色存储，用于权限过滤与角色切换 */
    roleStore: RoleStore;
    /** 技能存储，用于获取角色允许的技能 */
    skillStore: SkillStore;
}

/** Agent 运行结果 */
export interface AgentRunResult {
    /** 是否成功生成回复 */
    success: boolean;
    /** 最终回复文本 */
    finalText: string;
    /** 执行步数 */
    steps: number;
    /** 工具调用次数 */
    toolCalls: number;
    /** Token 使用统计 */
    tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /** 错误信息（仅在 success 为 false 时存在） */
    error?: string;
}

/** LLM Agent 引擎
 *
 * 每个会话对应一个 AgentEngine 实例，持有独立的记忆与配置。
 * 通过 aesyiu 库构建引擎，支持多步工具调用循环。
 */
export class AgentEngine {
    readonly chatId: string;
    private instanceId: string;
    private config: Required<Omit<AgentEngineConfig, 'memory'>> & {
        memory?: SessionMemoryManager;
    };
    private memory: SessionMemoryManager;
    private readonly toolCatalog: ToolCatalog;
    private readonly hookRuntime: PluginHookRuntime;

    constructor(chatId: string, config: AgentEngineConfig) {
        this.chatId = chatId;
        this.instanceId = `agent-${chatId}-${Date.now()}`;
        this.config = {
            maxSteps: config.maxSteps || 15,
            systemPrompt: config.systemPrompt || '你是一个有帮助的AI助手。',
            tools: config.tools || [],
            llm: config.llm,
            memory: config.memory,
            memoryConfig: config.memoryConfig || {},
            toolCatalog: config.toolCatalog,
            hookRuntime: config.hookRuntime,
            configSource: config.configSource,
            roleStore: config.roleStore,
            skillStore: config.skillStore,
        };
        this.toolCatalog = config.toolCatalog;
        this.hookRuntime = config.hookRuntime;

        this.memory =
            config.memory ??
            new SessionMemoryManager(chatId, this.config.memoryConfig, {
                systemPromptBuilder: {
                    buildSystemPrompt: ({ roleId, chatId: currentChatId }): string =>
                        this.config.systemPrompt || `${roleId}:${currentChatId}`,
                },
                roleManager: this.config.roleStore,
                toolCatalog: this.toolCatalog,
            });

        if (!this.memory.hasMessages()) {
            this.memory.importMemory([
                { role: MessageRole.System, content: this.config.systemPrompt },
            ]);
        }

        logger.info(
            {
                chatId: this.chatId,
                instanceId: this.instanceId,
                model: this.config.llm.model,
                maxSteps: this.config.maxSteps,
            },
            'AgentEngine initialized with aesyiu runtime',
        );
    }

    /** 按角色权限过滤可用工具
     *
     * 过滤逻辑：先从角色存储获取允许的工具名列表，
     * 再与配置中指定的工具名列表（如有）取交集。
     */
    private getFilteredTools(): Tool[] {
        const allToolDefs = this.toolCatalog.getAllToolDefinitions();
        const roleId = this.memory.getActiveRoleId();
        const allowedToolNames = this.config.roleStore.getAllowedTools(
            roleId,
            allToolDefs.map((tool) => tool.name),
        );

        const configuredToolSet = this.config.tools.length > 0 ? new Set(this.config.tools) : null;

        return allowedToolNames
            .filter((toolName) => !configuredToolSet || configuredToolSet.has(toolName))
            .map((toolName) => this.toolCatalog.getTool(toolName))
            .filter((tool): tool is Tool => Boolean(tool));
    }

    /** 获取角色允许使用的技能列表 */
    private getAllowedSkills(roleId: string): AgentSkill[] {
        if (!this.config.skillStore.isInitialized()) {
            return [];
        }
        return this.config.skillStore.getSkillsForRole(
            this.config.roleStore.getRoleConfig(roleId).allowed_skills,
        );
    }

    /** 将 aesyiu 消息同步到会话记忆管理器 */
    private syncMemory(messages: readonly AesyiuMessage[]): void {
        this.memory.importMemory(messages.map(toStandardMessage));
    }

    /** 执行 Agent 运行循环
     *
     * 处理用户输入，通过 LLM 生成回复，可能包含多步工具调用。
     * 运行过程中会触发插件钩子，结果同步到会话记忆。
     */
    async run(userInput: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
        logger.info(
            {
                chatId: this.chatId,
                instanceId: this.instanceId,
                inputLength: userInput.length,
            },
            'AgentEngine starting request processing',
        );

        const stats: AesyiuRunStats = { steps: 0, toolCalls: 0 };

        try {
            const filteredTools = this.getFilteredTools();
            const roleId = this.memory.getActiveRoleId();
            const allowedSkills = this.getAllowedSkills(roleId);

            const { engine, context } = buildAesyiuEngine({
                chatId: this.chatId,
                llmConfig: this.config.llm,
                providers: this.config.configSource.getConfig().providers,
                maxContextTokens: this.config.memoryConfig.maxContextTokens || 128000,
                compressionThreshold: this.config.memoryConfig.compressionThreshold || 0.75,
                maxSteps: this.config.maxSteps,
                filteredTools,
                allowedSkills,
                messages: this.memory.getMessages().map(toAesyiuMessage),
                stats,
                hookRuntime: this.hookRuntime,
                createToolContext: (ctx): ToolExecuteContext => ({
                    roleId: this.memory.getActiveRoleId(),
                    allowedTools: filteredTools.map((t) => t.name),
                    allowedSkills: allowedSkills.map((s) => s.name),
                    chatId: this.chatId,
                    senderId: 'user',
                    send: options.send,
                    agentContext: ctx,
                }),
                // 工具权限二次校验：角色不允许使用的工具直接返回错误
                checkToolAllowed: (tool): ToolExecutionResult | null => {
                    const currentRoleId = this.memory.getActiveRoleId();
                    if (!this.config.roleStore.isToolAllowed(currentRoleId, tool.name)) {
                        return {
                            success: false,
                            content: '',
                            error: `角色 "${currentRoleId}" 不允许使用工具 "${tool.name}"。`,
                        };
                    }
                    return null;
                },
                getRoleId: () => this.memory.getActiveRoleId(),
                roleCatalog: this.config.roleStore,
            });

            const result = await engine.run(
                {
                    role: 'user',
                    content: userInput,
                },
                context,
            );

            this.syncMemory(result.visibleMessages);

            const finalText =
                result.status === 'max_steps_reached'
                    ? `抱歉，任务在 ${this.config.maxSteps} 步后仍未完成。请简化您的请求或分步进行。`
                    : getFinalAssistantText(result.visibleMessages);

            if (!finalText || !result.usage || result.usage.totalTokens === 0) {
                logger.warn(
                    {
                        chatId: this.chatId,
                        instanceId: this.instanceId,
                        finalTextLength: finalText.length,
                        usage: result.usage,
                        visibleMessages: result.visibleMessages.map((message) => ({
                            role: message.role,
                            contentLength: message.content?.length ?? 0,
                            hasToolCalls: Boolean(message.tool_calls?.length),
                        })),
                        diagnostics: inspectEngineToolParameters(engine),
                    },
                    'AgentEngine returned empty output or zero usage',
                );
            }

            logger.info(
                {
                    chatId: this.chatId,
                    instanceId: this.instanceId,
                    status: result.status,
                    steps: stats.steps,
                    toolCalls: stats.toolCalls,
                    tokenUsage: result.usage,
                },
                'AgentEngine run completed',
            );

            if (result.status === 'error') {
                return {
                    success: false,
                    finalText: `执行错误: ${stats.error || '未知错误'}`,
                    steps: stats.steps,
                    toolCalls: stats.toolCalls,
                    tokenUsage: result.usage,
                    error: stats.error || 'Unknown engine error',
                };
            }

            return {
                success: true,
                finalText,
                steps: stats.steps,
                toolCalls: stats.toolCalls,
                tokenUsage: result.usage,
            };
        } catch (error) {
            const errorMessage = toErrorMessage(error);

            logger.error(
                {
                    chatId: this.chatId,
                    instanceId: this.instanceId,
                    error: errorMessage,
                },
                'AgentEngine execution failed',
            );

            return {
                success: false,
                finalText: `执行错误: ${errorMessage}`,
                steps: stats.steps,
                toolCalls: stats.toolCalls,
                error: errorMessage,
            };
        }
    }

    /** 更新 LLM 模型配置
     *
     * 先尝试从配置中解析模型标识符（可能是 provider/model 格式），
     * 解析失败时直接作为原始模型 ID 使用。
     */
    updateModel(model: string): void {
        try {
            const resolved = resolveLLMConfig(model, this.config.configSource.getConfig());
            this.config.llm = {
                ...this.config.llm,
                ...resolved,
            };

            logger.info(
                { chatId: this.chatId, modelIdentifier: model, model: resolved.model },
                'Agent model updated from role config',
            );
            return;
        } catch (error) {
            logger.warn(
                { chatId: this.chatId, modelIdentifier: model, error },
                'Failed to resolve model from config, using as raw model id',
            );
        }

        this.config.llm.model = model;
        logger.info({ chatId: this.chatId, model }, 'Agent model updated');
    }

    /** 获取当前运行时信息（LLM 配置与系统提示词） */
    getRuntimeInfo(): { llm: LLMConfig; systemPrompt: string } {
        return {
            llm: { ...this.config.llm },
            systemPrompt: this.config.systemPrompt,
        };
    }
}
