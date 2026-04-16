import { randomUUID } from 'crypto';
import { AgentEngine } from '@/agent/engine.js';
import { SessionMemoryManager } from '@/agent/memory/session-memory-manager.js';
import type { SessionMemoryConfig } from '@/agent/memory/types.js';
import { resolveLLMConfig } from '@/agent/runtime/resolve-llm-config.js';
import type { IUnifiedMessage } from '@/agent/types.js';
import type { CommandContext } from '@/contracts/commands.js';
import { configManager } from '@/features/config/config-manager.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { systemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { DEFAULT_ROLE_ID } from '@/features/roles/types.js';
import { MessageRole, type StandardMessage } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import type { SessionContext, SessionRecord } from './session-context.js';
import { sessionMessageRepository, type ReplaceSessionMessagesInput } from '@/platform/db/repositories/session-message-repository.js';
import { sessionRepository, type SessionRecord as PersistedSessionRecord, type SessionScope } from '@/platform/db/repositories/session-repository.js';
import { sqliteManager } from '@/platform/db/sqlite-manager.js';

export interface SessionSummary {
  session: SessionRecord;
  isCurrent: boolean;
}

export interface TemporarySessionOptions {
  chatId: string;
}

export interface TemporarySessionResult {
  sessionId: string;
  session: SessionContext;
}

export interface RoleInfo {
  roleId: string;
  roleName: string;
  allowedTools: string[];
}

type SessionMemoryConfigSource = {
  max_context_tokens: number;
  compression_threshold: number;
};

class SessionService {
  resolveInteractiveSessionForInbound(inbound: IUnifiedMessage): SessionContext {
    return this.createRuntimeSession(this.getOrCreateInteractiveSession(this.scopeFromInbound(inbound)));
  }

  getCurrentSessionForCommandContext(ctx: CommandContext): SessionRecord | null {
    const record = sessionRepository.findLatestByScope(this.scopeFromCommand(ctx));
    return record ? this.toDomainSession(record) : null;
  }

  getRuntimeSessionForCommandContext(ctx: CommandContext): SessionContext | null {
    const record = this.getCurrentSessionForCommandContext(ctx);
    if (!record) {
      return null;
    }

    return this.createRuntimeSession(record);
  }

  listSessionSummaries(): SessionSummary[] {
    const sessions = sessionRepository.findAll().map(record => this.toDomainSession(record));

    const latestByScope = new Set<string>();
    const seenScopes = new Set<string>();
    for (const session of sessions) {
      const scopeKey = this.scopeKey(session);
      if (!seenScopes.has(scopeKey)) {
        seenScopes.add(scopeKey);
        latestByScope.add(session.id);
      }
    }

    return sessions.map(session => ({
      session,
      isCurrent: latestByScope.has(session.id),
    }));
  }

  clearSession(sessionId: string): boolean {
    return sqliteDeleteSession(sessionId);
  }

  persistRuntimeSession(session: SessionContext): SessionRecord {
    const messages = session.memory.getMessages().filter(message => message.role !== MessageRole.System);
    const persistableMessages = messages.map<ReplaceSessionMessagesInput>(message => ({
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
      name: message.name,
    }));

    sessionMessageRepository.replaceForSession(session.session.id, persistableMessages);

    const updated = sessionRepository.updateState(session.session.id, {
      roleId: session.memory.getActiveRoleId(),
      messageCount: messages.filter(message => message.role === MessageRole.User).length,
    });

    const nextRecord = updated ?? session.session;
    session.session = this.toDomainSession(nextRecord);
    return session.session;
  }

  getRoleInfoForCommandContext(ctx: CommandContext): RoleInfo {
    const session = this.getCurrentSessionForCommandContext(ctx);
    const roleId = session?.roleId ?? DEFAULT_ROLE_ID;
    const roleConfig = roleManager.getRoleConfig(roleId);

    return {
      roleId,
      roleName: roleConfig.name,
      allowedTools: roleConfig.allowed_tools,
    };
  }

  switchRoleForCommandContext(ctx: CommandContext, roleId: string): { success: boolean; message: string } {
    const role = roleManager.getRole(roleId);
    if (!role) {
      const roleNames = roleManager.getAllRoles().map(item => item.name).join(', ');
      return {
        success: false,
        message: `角色 "${roleId}" 不存在。可用角色: ${roleNames}`,
      };
    }

    const current = this.getOrCreateInteractiveSession(this.scopeFromCommand(ctx));
    const updated = sessionRepository.updateState(current.id, { roleId });
    if (!updated) {
      return {
        success: false,
        message: `切换到角色 "${roleId}" 失败`,
      };
    }

    const allowedTools = role.allowed_tools.includes('*') ? '所有工具' : role.allowed_tools.join(', ');
    return {
      success: true,
      message: `已成功切换至角色：${role.name}\n可用工具: ${allowedTools}`,
    };
  }

  createTemporarySession(_cronJobId: string, options: TemporarySessionOptions): TemporarySessionResult {
    const sessionId = `temp-${randomUUID()}`;
    const session = this.createEphemeralRuntimeSession({
      id: sessionId,
      channel: 'cron',
      type: 'cron',
      chatId: options.chatId,
      roleId: DEFAULT_ROLE_ID,
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { sessionId, session };
  }

  private getOrCreateInteractiveSession(scope: SessionScope): SessionRecord {
    const existing = sessionRepository.findLatestByScope(scope);
    return existing ? this.toDomainSession(existing) : this.createInteractiveSession(scope);
  }

  private createInteractiveSession(scope: SessionScope): SessionRecord {
    return this.toDomainSession(sessionRepository.create({
      id: randomUUID(),
      chatId: scope.chatId,
      channel: scope.channel,
      type: scope.type,
      roleId: DEFAULT_ROLE_ID,
    }));
  }

  private createRuntimeSession(record: SessionRecord): SessionContext {
    return this.createRuntimeSessionFromRecord(record, sessionMessageRepository.findBySessionId(record.id).map(message => ({
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
      name: message.name,
    })));
  }

  private createEphemeralRuntimeSession(record: SessionRecord): SessionContext {
    return this.createRuntimeSessionFromRecord(record, []);
  }

  private createRuntimeSessionFromRecord(record: SessionRecord, messages: StandardMessage[]): SessionContext {
    const normalizedRecord = this.normalizeSession(record);
    const memoryConfig = this.getMemoryConfig();
    const memory = new SessionMemoryManager(normalizedRecord.id, memoryConfig, {
      systemPromptBuilder: systemPromptManager,
      roleManager,
    });

    if (normalizedRecord.roleId !== DEFAULT_ROLE_ID) {
      memory.setActiveRole(normalizedRecord.roleId);
    }

    const systemPrompt = systemPromptManager.buildSystemPrompt({
      roleId: normalizedRecord.roleId,
      chatId: normalizedRecord.chatId,
    });

    memory.importMemory([
      {
        role: MessageRole.System,
        content: systemPrompt,
      },
      ...messages,
    ]);

    const roleConfig = roleManager.getRoleConfig(normalizedRecord.roleId);
    const agent = new AgentEngine(normalizedRecord.id, {
      llm: resolveLLMConfig(roleConfig.model, configManager.config),
      maxSteps: configManager.config.agent.max_steps,
      systemPrompt,
      memory,
      memoryConfig,
    });

    return {
      session: normalizedRecord,
      memory,
      agent,
    };
  }

  private normalizeSession(record: SessionRecord): SessionRecord {
    const roleId = roleManager.getRole(record.roleId) ? record.roleId : DEFAULT_ROLE_ID;
    if (roleId === record.roleId) {
      return this.toDomainSession(record);
    }

    const updated = sessionRepository.updateState(record.id, { roleId });
    return this.toDomainSession(updated ?? { ...record, roleId });
  }

  private getMemoryConfig(): SessionMemoryConfig {
    const rawConfig = configManager.config.memory as SessionMemoryConfigSource;
    return {
      maxContextTokens: rawConfig.max_context_tokens,
      compressionThreshold: rawConfig.compression_threshold,
    };
  }

  private scopeFromInbound(inbound: IUnifiedMessage): SessionScope {
    return {
      channel: inbound.channelId,
      type: (inbound.metadata?.type as string) || 'default',
      chatId: inbound.chatId,
    };
  }

  private scopeFromCommand(ctx: CommandContext): SessionScope {
    return {
      channel: ctx.channelId,
      type: ctx.messageType,
      chatId: ctx.chatId,
    };
  }

  private scopeKey(session: Pick<SessionRecord, 'channel' | 'type' | 'chatId'>): string {
    return `${session.channel}:${session.type}:${session.chatId}`;
  }

  private toDomainSession(record: PersistedSessionRecord | SessionRecord): SessionRecord {
    return {
      ...record,
      createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt),
      updatedAt: record.updatedAt instanceof Date ? record.updatedAt : new Date(record.updatedAt),
    };
  }
}

function sqliteDeleteSession(sessionId: string): boolean {
  let deleted = false;

  sqliteManager.transaction(() => {
    sessionMessageRepository.deleteBySessionId(sessionId);
    deleted = sessionRepository.delete(sessionId);
  });

  return deleted;
}

export const sessionService = new SessionService();
