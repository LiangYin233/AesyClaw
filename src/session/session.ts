import {
  completeMessageUsage,
  type SessionKey,
  type PersistableMessage,
} from '@aesyclaw/core/types';
import {
  assistantHasToolCalls,
  createUserMessage,
  extractMessageText,
  type AgentMessage,
} from '@aesyclaw/contracts/llm';
import { createPersistedAssistantMessage } from '@aesyclaw/agent/types';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type {
  MessagesRepository,
  UsageRepository,
  ToolUsageRepository,
} from '@aesyclaw/core/database/database-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { compactSession } from './session-compactor';

const logger = createScopedLogger('session');

/**
 * Session — 会话实例，管理消息历史与并发锁。
 *
 * 持有会话消息列表、数据库持久化、用量记录等功能。
 * 每次只允许一个 Agent 处理请求（通过 lock/unlock 控制）。
 */
export class Session {
  readonly sessionId: string;
  readonly key: SessionKey;
  private _messages: AgentMessage[] = [];
  private _locked = false;

  /**
   * @param sessionId - 数据库中的会话 ID
   * @param key - 会话键
   * @param db - 数据库访问层（messages / usage / toolUsage）
   */
  constructor(
    sessionId: string,
    key: SessionKey,
    private db: {
      messages: MessagesRepository;
      usage?: UsageRepository;
      toolUsage?: ToolUsageRepository;
    },
  ) {
    this.sessionId = sessionId;
    this.key = key;
  }

  /** 会话当前是否被锁定（有正在进行的 Agent 处理） */
  get isLocked(): boolean {
    return this._locked;
  }

  /**
   * 锁定会话，确保同一时间只有一个 Agent 处理。
   * @returns true 表示锁定成功，false 表示已被锁定
   */
  lock(): boolean {
    if (this._locked) return false;
    this._locked = true;
    return true;
  }

  /** 解除会话锁定 */
  unlock(): void {
    this._locked = false;
  }

  /**
   * 获取当前消息列表的只读副本。
   * @returns 当前会话中的所有消息
   */
  get(): readonly AgentMessage[] {
    return this._messages;
  }

  /**
   * 从数据库加载历史消息并绑定到内存。
   */
  async bind(): Promise<void> {
    const records = await this.db.messages.loadHistory(this.sessionId);
    this._messages = records.map((r) =>
      r.role === 'user'
        ? createUserMessage(r.content, parseTimestamp(r.timestamp))
        : createPersistedAssistantMessage(
            r.content,
            parseTimestamp(r.timestamp),
            completeMessageUsage(r.usage),
          ),
    );
  }

  /**
   * 添加一条消息到会话。
   *
   * 消息会同时写入数据库持久化。
   * @param message - 要添加的消息
   */
  async add(message: AgentMessage): Promise<void> {
    this._messages.push(message);

    const persistable = toPersistable(message);
    const messageId = persistable
      ? await this.db.messages.save(this.sessionId, persistable)
      : undefined;

    await this.recordUsageIfApplicable(message, messageId);
  }

  /**
   * 从 Agent 同步消息列表到会话。
   *
   * 会清理无效的 toolCall 块并记录工具调用统计。
   * @param agentMessages - Agent 返回的消息列表
   */
  async syncFromAgent(agentMessages: AgentMessage[]): Promise<void> {
    sanitizeGhostToolCalls(agentMessages);

    for (const msg of agentMessages) {
      await this.add(msg);
      const persistedToolText = getPersistedAssistantTextFromToolResult(msg);
      if (persistedToolText) {
        await this.add(createPersistedAssistantMessage(persistedToolText));
      }
    }

    await this.recordToolCallsFromMessages(agentMessages);
  }

  /**
   * 清除当前会话的所有消息历史。
   */
  async clear(): Promise<void> {
    this._messages = [];
    await this.db.messages.clearHistory(this.sessionId);
    logger.info('会话历史已清除', { sessionId: this.sessionId });
  }

  /**
   * 使用 LLM 压缩会话历史为摘要文本。
   *
   * 原始消息会被替换为压缩摘要，消息列表重新从数据库加载。
   * @param llmAdapter - LLM 适配器
   * @param modelIdentifier - 模型标识符
   * @returns 压缩后的摘要文本
   */
  async compact(llmAdapter: LlmAdapter, modelIdentifier: string): Promise<string> {
    return await compactSession(llmAdapter, modelIdentifier, {
      sessionId: this.sessionId,
      get: () => this.get(),
      bind: () => this.bind(),
      db: this.db as { messages: MessagesRepository; usage?: UsageRepository },
    });
  }

  /**
   * 筛选符合条件的消息。
   * @param pred - 筛选谓词函数
   * @returns 匹配的消息数组
   */
  filter(pred: (msg: AgentMessage) => boolean): AgentMessage[] {
    return this._messages.filter(pred);
  }

  private async recordUsageIfApplicable(message: AgentMessage, messageId?: number): Promise<void> {
    if (
      this.db.usage === undefined ||
      messageId === undefined ||
      message.role !== 'assistant' ||
      message.usage === undefined ||
      message.usage.totalTokens <= 0
    )
      return;

    try {
      await this.db.usage.create({
        model: message.model,
        provider: message.provider,
        api: message.api,
        responseId: message.responseId,
        sessionId: this.sessionId,
        messageId,
        usage: message.usage,
      });
    } catch (err) {
      logger.error('记录用量失败', err);
    }
  }

  private async recordToolCallsFromMessages(agentMessages: AgentMessage[]): Promise<void> {
    if (!this.db.toolUsage) return;

    for (const message of agentMessages) {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

      for (const block of message.content) {
        if (typeof block !== 'object' || !('type' in block)) continue;
        if (block.type !== 'toolCall') continue;

        const toolCall = block as { name: string; arguments?: Record<string, unknown> };
        try {
          await this.db.toolUsage.create({ name: toolCall.name, type: 'tool' });
        } catch (err) {
          logger.error('记录工具调用失败', err);
        }

        const skillName = toolCall.arguments?.['skillName'];
        if (toolCall.name === 'load_skill' && typeof skillName === 'string') {
          try {
            await this.db.toolUsage.create({ name: String(skillName), type: 'skill' });
          } catch (err) {
            logger.error('记录技能加载调用失败', err);
          }
        }
      }
    }
}

/**
 * 过滤掉 AI 幻觉遗留的幽灵 toolCall 块（LLM 声明调用工具但未正确执行）。
 * 这些块只有 type 没有 name，会导致后续处理出错。
 */
function sanitizeGhostToolCalls(agentMessages: AgentMessage[]): void {
  for (const message of agentMessages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

    const filtered = (message.content as Array<{ type?: string; name?: string }>).filter(
      (block) => {
        if (block.type !== 'toolCall') return true;
        if (block.name) return true;
        logger.warn('清理幽灵 ToolCall 块', { blockId: (block as Record<string, unknown>)['id'] });
        return false;
      },
    );

    if (filtered.length < message.content.length) {
      (message as unknown as Record<string, unknown>)['content'] = filtered;
    }
  }
}

function toPersistable(message: AgentMessage): PersistableMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  if (message.role === 'assistant' && assistantHasToolCalls(message)) return null;

  const text = extractMessageText(message).trim();
  if (text.length === 0) return null;

  return {
    role: message.role,
    content: text,
    timestamp: new Date().toISOString(),
  };
}

function getPersistedAssistantTextFromToolResult(message: AgentMessage): string | null {
  if (message.role !== 'toolResult') return null;
  if (message.toolName !== 'send_msg' || message.isError === true) return null;

  const details = (message as unknown as Record<string, unknown>)['details'];
  if (typeof details !== 'object' || details === null) return null;

  const text = (details as Record<string, unknown>)['persistAsAssistantText'];
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
}

function parseTimestamp(timestamp?: string): number {
  if (!timestamp) return Date.now();
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/**
 * 估算消息列表的近似 token 数量。
 *
 * 使用粗略的 4 字符 ≈ 1 token 估算。
 * @param messages - 消息列表
 * @returns 估计的 token 数
 */
export function estimateApproximateTokens(messages: readonly AgentMessage[]): number {
  const textLength = messages.reduce(
    (total, message) => total + extractMessageText(message).length,
    0,
  );
  return Math.ceil(textLength / 4);
}
