import { AgentEngine } from '@/agent/engine.js';
import { SessionMemoryManager } from '@/agent/memory/session-memory-manager.js';
import { type SessionMemoryConfig } from '@/agent/memory/types.js';
import { manuallyCompactMessages } from '@/agent/runtime/aesyiu-runtime-helpers.js';
import { resolveLLMConfig } from '@/agent/runtime/resolve-llm-config.js';
import type { ChannelReceiveMessage } from '@/agent/types.js';
import type { CommandContext } from '@/contracts/commands.js';
import { configManager } from '@/features/config/config-manager.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { systemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { DEFAULT_ROLE_ID } from '@/features/roles/types.js';
import { MessageRole, type StandardMessage } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import type { ChatContext, ChatSession } from './session-context.js';
import { chatStore, type ChatKey } from '@/platform/db/repositories/session-repository.js';
import { toolRegistry } from '@/platform/tools/registry.js';

export interface RoleInfo {
  roleId: string;
  roleName: string;
  allowedTools: string[];
}

type MemoryConfigSource = {
  max_context_tokens: number;
  compression_threshold: number;
};

class ChatService {
  resolveForReceive(received: ChannelReceiveMessage): ChatContext {
    return this.buildContext(this.getOrCreate(toChatKey(received)));
  }

  getForCommand(ctx: CommandContext): ChatContext | null {
    const session = chatStore.get(toChatKeyFromCommand(ctx));
    return session ? this.buildContext(session) : null;
  }

  clearChat(ctx: CommandContext): boolean {
    const key = toChatKeyFromCommand(ctx);
    chatStore.saveMessages(key, []);
    return true;
  }

  async compactChat(ctx: CommandContext): Promise<{ success: boolean; message: string }> {
    const session = this.getForCommand(ctx);
    if (!session) {
      return { success: false, message: '会话不存在' };
    }

    const roleConfig = roleManager.getRoleConfig(session.memory.getActiveRoleId());
    const memoryConfig = this.getMemoryConfig();
    const compacted = await manuallyCompactMessages({
      chatId: session.session.chatId,
      llmConfig: resolveLLMConfig(roleConfig.model, configManager.config),
      maxContextTokens: memoryConfig.maxContextTokens,
      compressionThreshold: memoryConfig.compressionThreshold,
      messages: [...session.memory.getMessages()],
    });

    session.memory.importMemory(compacted);
    this.save(session);
    return { success: true, message: `会话已压缩（session: ${session.session.chatId}）` };
  }

  switchRole(ctx: CommandContext, roleId: string): { success: boolean; message: string } {
    const role = roleManager.getRole(roleId);
    if (!role) {
      const roleNames = roleManager.getAllRoles().map(item => item.name).join(', ');
      return { success: false, message: `角色 "${roleId}" 不存在。可用角色: ${roleNames}` };
    }

    const key = toChatKeyFromCommand(ctx);
    chatStore.updateRole(key, roleId);

    const allowedTools = this.getAllowedToolsForRole(roleId);
    const allowedToolsText = allowedTools.length > 0 ? allowedTools.join(', ') : '无';
    return { success: true, message: `已成功切换至角色：${role.name}\n可用工具: ${allowedToolsText}` };
  }

  getRoleInfo(ctx: CommandContext): RoleInfo {
    const session = chatStore.get(toChatKeyFromCommand(ctx));
    const roleId = session?.roleId ?? DEFAULT_ROLE_ID;
    const roleConfig = roleManager.getRoleConfig(roleId);
    return { roleId, roleName: roleConfig.name, allowedTools: this.getAllowedToolsForRole(roleId) };
  }

  private getAllowedToolsForRole(roleId: string): string[] {
    return roleManager.getAllowedTools(
      roleId,
      toolRegistry.getAllToolDefinitions().map(tool => tool.name)
    );
  }

  private getOrCreate(key: ChatKey): ChatSession {
    const existing = chatStore.get(key);
    if (existing) return existing;
    return chatStore.create(key);
  }

  save(context: ChatContext): void {
    const messages = context.memory.getMessages().filter(message => shouldPersistMessage(message));
    chatStore.saveMessages(
      { channel: context.session.channel, type: context.session.type, chatId: context.session.chatId },
      messages
    );
  }

  private buildContext(session: ChatSession): ChatContext {
    const key = { channel: session.channel, type: session.type, chatId: session.chatId };
    const memoryConfig = this.getMemoryConfig();
    const memory = new SessionMemoryManager(session.chatId, memoryConfig, {
      systemPromptBuilder: systemPromptManager,
      roleManager,
    });

    if (session.roleId !== DEFAULT_ROLE_ID) {
      memory.setActiveRole(session.roleId);
    }

    const systemPrompt = systemPromptManager.buildSystemPrompt({
      roleId: session.roleId,
      chatId: session.chatId,
    });

    const savedMessages = chatStore.getMessages(key);
    memory.importMemory([{ role: MessageRole.System, content: systemPrompt }, ...savedMessages]);

    const roleConfig = roleManager.getRoleConfig(session.roleId);
    const agent = new AgentEngine(session.chatId, {
      llm: resolveLLMConfig(roleConfig.model, configManager.config),
      maxSteps: configManager.config.agent.max_steps,
      systemPrompt,
      memory,
      memoryConfig,
    });

    return { session, memory, agent };
  }

  private getMemoryConfig(): SessionMemoryConfig {
    const raw = configManager.config.memory as MemoryConfigSource;
    return {
      maxContextTokens: raw.max_context_tokens,
      compressionThreshold: raw.compression_threshold,
    };
  }
}

function shouldPersistMessage(message: StandardMessage): boolean {
  if (message.role === MessageRole.System || message.role === MessageRole.User) {
    return true;
  }
  if (message.role === MessageRole.Tool) {
    return false;
  }
  return !message.toolCalls?.length && message.content.trim().length > 0;
}

function toChatKey(received: Pick<ChannelReceiveMessage, 'channelId' | 'chatId' | 'metadata'>): ChatKey {
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

export const chatService = new ChatService();
