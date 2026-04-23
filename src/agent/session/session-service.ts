/** @file 会话服务
 *
 * ChatService 管理聊天会话的生命周期，包括：
 * - 会话获取/创建（resolveForReceive、getOrCreate）
 * - 会话上下文构建（buildContext）：加载历史消息、构建系统提示词、创建 AgentEngine
 * - 角色切换（switchRole）与角色信息查询（getRoleInfo）
 * - 会话压缩（compactChat）：将历史消息压缩为摘要
 * - 会话清理（clearChat）
 *
 * 会话通过 ChatKey（channel + type + chatId）唯一标识，
 * 持久化到 SQLite 数据库中。
 */

import { AgentEngine } from '@/agent/engine.js';
import { SessionMemoryManager } from '@/agent/memory/session-memory-manager.js';
import { type SessionMemoryConfig } from '@/agent/memory/types.js';
import { manuallyCompactMessages } from '@/agent/runtime/compact-messages.js';
import { resolveLLMConfig } from '@/agent/runtime/resolve-llm-config.js';
import type { ChannelReceiveMessage } from '@/agent/types.js';
import type { CommandContext } from '@/contracts/commands.js';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import type {
    ChatSessionStore,
    ConfigSource,
    RoleStore,
    SkillStore,
} from '@/contracts/runtime-services.js';
import type { SystemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { DEFAULT_ROLE_ID } from '@/features/roles/types.js';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { ChatContext, ChatSession } from './session-context.js';
import type { ChatKey } from '@/platform/db/repositories/session-repository.js';
import type { ToolCatalog } from '@/platform/tools/registry.js';

/** 角色信息摘要 */
export interface RoleInfo {
    roleId: string;
    roleName: string;
    allowedTools: string[];
}

type MemoryConfigSource = {
    max_context_tokens: number;
    compression_threshold: number;
};

export interface ChatServiceDependencies {
    systemPromptManager: SystemPromptManager;
    toolCatalog: ToolCatalog;
    hookRuntime: PluginHookRuntime;
    configSource: ConfigSource;
    roleStore: RoleStore;
    chatStore: Pick<
        ChatSessionStore,
        'get' | 'create' | 'updateRole' | 'getMessages' | 'saveMessages'
    >;
    skillStore: SkillStore;
}

/** 会话服务
 *
 * 管理会话的创建、查询、角色切换与 AgentEngine 构建。
 */
export class ChatService {
    constructor(private readonly deps: ChatServiceDependencies) {}

    /** 根据收到的消息解析或创建会话上下文 */
    resolveForReceive(received: ChannelReceiveMessage): ChatContext {
        return this.buildContext(this.getOrCreate(toChatKey(received)));
    }

    /** 根据命令上下文获取会话上下文 */
    getForCommand(ctx: CommandContext): ChatContext | null {
        const session = this.deps.chatStore.get(toChatKeyFromCommand(ctx));
        return session ? this.buildContext(session) : null;
    }

    /** 清空会话历史消息 */
    clearChat(ctx: CommandContext): boolean {
        const key = toChatKeyFromCommand(ctx);
        this.deps.chatStore.saveMessages(key, []);
        return true;
    }

    /** 压缩会话历史消息
     *
     * 使用 LLM 将历史消息压缩为摘要，减少上下文占用。
     */
    async compactChat(ctx: CommandContext): Promise<{ success: boolean; message: string }> {
        const session = this.getForCommand(ctx);
        if (!session) {
            return { success: false, message: '会话不存在' };
        }

        const roleConfig = this.deps.roleStore.getRoleConfig(session.memory.getActiveRoleId());
        const config = this.deps.configSource.getConfig();
        const compacted = await manuallyCompactMessages({
            chatId: session.session.chatId,
            llmConfig: resolveLLMConfig(roleConfig.model, config),
            messages: [...session.memory.getMessages()],
        });

        session.memory.importMemory(compacted);
        this.save(session);
        return {
            success: true,
            message: `会话已压缩（session: ${session.session.chatId}）`,
        };
    }

    /** 切换会话角色 */
    switchRole(ctx: CommandContext, roleId: string): { success: boolean; message: string } {
        const role = this.deps.roleStore.getRole(roleId);
        if (!role) {
            const roleNames = this.deps.roleStore
                .getAllRoles()
                .map((item) => item.name)
                .join(', ');
            return {
                success: false,
                message: `角色 "${roleId}" 不存在。可用角色: ${roleNames}`,
            };
        }

        const key = toChatKeyFromCommand(ctx);
        this.deps.chatStore.updateRole(key, roleId);

        const allowedTools = this.getAllowedToolsForRole(roleId);
        const allowedToolsText = allowedTools.length > 0 ? allowedTools.join(', ') : '无';
        return {
            success: true,
            message: `已成功切换至角色：${role.name}\n可用工具: ${allowedToolsText}`,
        };
    }

    /** 获取当前会话的角色信息 */
    getRoleInfo(ctx: CommandContext): RoleInfo {
        const session = this.deps.chatStore.get(toChatKeyFromCommand(ctx));
        const roleId = session?.roleId ?? DEFAULT_ROLE_ID;
        const roleConfig = this.deps.roleStore.getRoleConfig(roleId);
        return {
            roleId,
            roleName: roleConfig.name,
            allowedTools: this.getAllowedToolsForRole(roleId),
        };
    }

    private getAllowedToolsForRole(roleId: string): string[] {
        return this.deps.roleStore.getAllowedTools(
            roleId,
            this.deps.toolCatalog.getAllToolDefinitions().map((tool) => tool.name),
        );
    }

    private getOrCreate(key: ChatKey): ChatSession {
        const existing = this.deps.chatStore.get(key);
        if (existing) {
            return existing;
        }
        return this.deps.chatStore.create(key);
    }

    /** 保存会话消息到持久化存储
     *
     * 过滤掉不应持久化的消息（系统消息、工具调用结果、空内容）。
     */
    save(context: ChatContext): void {
        const messages = context.memory
            .getMessages()
            .filter((message) => shouldPersistMessage(message));
        this.deps.chatStore.saveMessages(
            {
                channel: context.session.channel,
                type: context.session.type,
                chatId: context.session.chatId,
            },
            messages,
        );
    }

    /** 构建会话上下文
     *
     * 加载历史消息、构建系统提示词、创建 AgentEngine。
     * AgentEngine 持有独立的 SessionMemoryManager 与配置。
     */
    private buildContext(session: ChatSession): ChatContext {
        const key = {
            channel: session.channel,
            type: session.type,
            chatId: session.chatId,
        };
        const memoryConfig = this.getMemoryConfig();
        const memory = new SessionMemoryManager(session.chatId, memoryConfig, {
            systemPromptBuilder: this.deps.systemPromptManager,
            roleManager: this.deps.roleStore,
            toolCatalog: this.deps.toolCatalog,
        });

        if (session.roleId !== DEFAULT_ROLE_ID) {
            memory.setActiveRole(session.roleId);
        }

        const systemPrompt = this.deps.systemPromptManager.buildSystemPrompt({
            roleId: session.roleId,
            chatId: session.chatId,
        });

        const savedMessages = this.deps.chatStore.getMessages(key);
        memory.setSystemPrompt(systemPrompt);
        memory.importMemory(savedMessages);

        const roleConfig = this.deps.roleStore.getRoleConfig(session.roleId);
        const config = this.deps.configSource.getConfig();
        const agent = new AgentEngine(session.chatId, {
            llm: resolveLLMConfig(roleConfig.model, config),
            maxSteps: config.agent.max_steps,
            systemPrompt,
            memory,
            memoryConfig,
            toolCatalog: this.deps.toolCatalog,
            hookRuntime: this.deps.hookRuntime,
            configSource: this.deps.configSource,
            roleStore: this.deps.roleStore,
            skillStore: this.deps.skillStore,
        });

        return { session, memory, agent };
    }

    private getMemoryConfig(): SessionMemoryConfig {
        const raw = this.deps.configSource.getConfig().memory as MemoryConfigSource;
        return {
            maxContextTokens: raw.max_context_tokens,
            compressionThreshold: raw.compression_threshold,
        };
    }
}

/** 判断消息是否应持久化到存储 */
function shouldPersistMessage(message: AgentMessage): boolean {
    if (message.role === 'user') {
        return true;
    }
    if (message.role === 'toolResult') {
        return false;
    }
    if (message.role === 'assistant') {
        const hasToolCalls = message.content.some((c) => c.type === 'toolCall');
        const textParts = message.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text);
        const text = textParts.join('');
        return !hasToolCalls && text.trim().length > 0;
    }
    return false;
}

function toChatKey(
    received: Pick<ChannelReceiveMessage, 'channelId' | 'chatId' | 'metadata'>,
): ChatKey {
    return {
        channel: received.channelId,
        type: (received.metadata?.type as string) || 'default',
        chatId: received.chatId,
    };
}

function toChatKeyFromCommand(ctx: CommandContext): ChatKey {
    return {
        channel: ctx.channelId,
        type: ctx.messageType,
        chatId: ctx.chatId,
    };
}
