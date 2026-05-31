import type {
  SessionKey,
  PersistableMessage,
  PersistableToolCall,
  PersistableToolResult,
} from '@aesyclaw/core/types';
import {
  assistantHasToolCalls,
  extractMessageText,
  type AgentMessage,
  type ModelResolver,
} from '@aesyclaw/contracts/llm';
import { createPersistedAssistantMessage } from '@aesyclaw/agent/types';
import type {
  UsageRepository,
  ToolUsageRepository,
} from '@aesyclaw/core/database/database-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { SessionFileStore } from './persistence/file-store';
import { compactSession } from './utils/compactor';
import { loadAndRehydrateMessages } from './persistence/rehydrate';

const logger = createScopedLogger('session');

export class Session {
  readonly sessionId: string;
  readonly key: SessionKey;
  private _messages: AgentMessage[] = [];
  private _locked = false;

  constructor(
    sessionId: string,
    key: SessionKey,
    private store: SessionFileStore,
    private usageRepo?: UsageRepository,
    private toolUsageRepo?: ToolUsageRepository,
  ) {
    this.sessionId = sessionId;
    this.key = key;
  }

  get isLocked(): boolean {
    return this._locked;
  }

  lock(): boolean {
    if (this._locked) return false;
    this._locked = true;
    return true;
  }

  unlock(): void {
    this._locked = false;
  }

  get(): readonly AgentMessage[] {
    return this._messages;
  }

  async bind(): Promise<void> {
    this._messages = await loadAndRehydrateMessages(this.store, this.sessionId);
  }

  async add(message: AgentMessage): Promise<void> {
    this._messages.push(message);
    const persistable = toPersistable(message);
    if (persistable) {
      await this.store.save(this.sessionId, persistable);
    }
    await this.recordUsageIfApplicable(message);
  }

  async syncFromAgent(agentMessages: AgentMessage[]): Promise<void> {
    const cleanedMessages = sanitizeGhostToolCalls(agentMessages);
    for (const msg of cleanedMessages) {
      await this.add(msg);
      const persistedToolText = getPersistedAssistantTextFromToolResult(msg);
      if (persistedToolText) {
        await this.add(createPersistedAssistantMessage(persistedToolText));
      }
    }
    await this.recordToolCallsFromMessages(cleanedMessages);
  }

  async clear(): Promise<void> {
    this._messages = [];
    await this.store.clear(this.sessionId);
    logger.info('会话历史已清除', { sessionId: this.sessionId });
  }

  resetMessages(): void {
    this._messages = [];
  }

  async compact(llmResolver: ModelResolver, modelIdentifier: string): Promise<string> {
    return await compactSession(llmResolver, modelIdentifier, {
      sessionId: this.sessionId,
      get: () => this.get(),
      bind: () => this.bind(),
      store: this.store,
      usageRepo: this.usageRepo,
    });
  }

  private async recordUsageIfApplicable(message: AgentMessage): Promise<void> {
    if (
      this.usageRepo === undefined ||
      message.role !== 'assistant' ||
      message.usage === undefined ||
      message.usage.totalTokens <= 0
    )
      return;

    try {
      await this.usageRepo.create({
        model: message.model,
        provider: message.provider,
        api: message.api,
        responseId: message.responseId,
        sessionId: this.sessionId,
        usage: message.usage,
      });
    } catch (err) {
      logger.error('记录用量失败', err);
    }
  }

  private async recordToolCallsFromMessages(agentMessages: AgentMessage[]): Promise<void> {
    if (!this.toolUsageRepo) return;

    for (const message of agentMessages) {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

      for (const block of message.content) {
        if (typeof block !== 'object' || !('type' in block)) continue;
        if (block.type !== 'toolCall') continue;

        const toolCall = block as { name: string; arguments?: Record<string, unknown> };
        try {
          await this.toolUsageRepo.create({ name: toolCall.name, type: 'tool' });
        } catch (err) {
          logger.error('记录工具调用失败', err);
        }

        const skillName = toolCall.arguments?.['skillName'];
        if (toolCall.name === 'load_skill' && typeof skillName === 'string') {
          try {
            await this.toolUsageRepo.create({ name: String(skillName), type: 'skill' });
          } catch (err) {
            logger.error('记录技能加载调用失败', err);
          }
        }
      }
    }
  }
}

function sanitizeGhostToolCalls(agentMessages: AgentMessage[]): AgentMessage[] {
  return agentMessages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return message;

    const filtered = (message.content as Array<{ type?: string; name?: string }>).filter(
      (block) => {
        if (block.type !== 'toolCall') return true;
        if (block.name) return true;
        logger.warn('清理幽灵 ToolCall 块', { blockId: (block as Record<string, unknown>)['id'] });
        return false;
      },
    );

    if (filtered.length === message.content.length) return message;

    // 创建新对象，避免变异原数组
    return {
      ...message,
      content: filtered as typeof message.content,
    };
  });
}

function toPersistable(message: AgentMessage): PersistableMessage | null {
  const text = extractMessageText(message).trim();

  // ── user: 仅持久化文本（不变） ────────────────────────────────
  if (message.role === 'user') {
    if (text.length === 0) return null;
    return { role: 'user', content: text, timestamp: new Date().toISOString() };
  }

  // ── assistant: 含 toolCall 时保留结构 ────────────────────────
  if (message.role === 'assistant') {
    const hasToolCalls = assistantHasToolCalls(message);
    if (!hasToolCalls) {
      if (text.length === 0) return null;
      return {
        role: 'assistant',
        content: text,
        timestamp: new Date().toISOString(),
        usage: message.usage,
      };
    }

    const toolCalls = (message.content as Array<{ type: string }>)
      .filter(
        (
          c,
        ): c is {
          type: 'toolCall';
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        } => c.type === 'toolCall',
      )
      .map(
        (tc) =>
          ({ id: tc.id, name: tc.name, arguments: tc.arguments }) satisfies PersistableToolCall,
      );
    // message 已收窄为 AssistantMessage，stopReason 直接可用
    const stopReason = message.stopReason;
    const wrapped = {
      toolCalls,
      ...(stopReason !== 'stop' ? { stopReason } : {}),
    };

    return {
      role: 'assistant',
      content: text,
      toolData: JSON.stringify(wrapped),
      timestamp: new Date().toISOString(),
      usage: message.usage,
    };
  }

  // ── toolResult: 新持久化 ─────────────────────────────────────
  if (message.role === 'toolResult') {
    const toolResult = message as AgentMessage & {
      toolCallId: string;
      toolName: string;
      isError: boolean;
      details?: unknown;
    };

    const toolData: PersistableToolResult = {
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      isError: toolResult.isError ?? false,
    };
    const rawDetails = toolResult.details;
    if (rawDetails !== undefined && rawDetails !== null && typeof rawDetails === 'object') {
      toolData.details = rawDetails as Record<string, unknown>;
    }

    return {
      role: 'toolResult',
      content: text,
      toolData: JSON.stringify(toolData),
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

function getPersistedAssistantTextFromToolResult(message: AgentMessage): string | null {
  if (message.role !== 'toolResult') return null;
  if (message.toolName !== 'send_msg' || message.isError === true) return null;

  const details = (message as unknown as Record<string, unknown>)['details'];
  if (typeof details !== 'object' || details === null) return null;

  const text = (details as Record<string, unknown>)['persistAsAssistantText'];
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
}
