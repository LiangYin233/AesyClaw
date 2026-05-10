import type { SessionKey, PersistableMessage } from '@aesyclaw/core/types';
import {
  assistantHasToolCalls,
  createPersistedAssistantMessage,
  createUserMessage,
  extractMessageText,
  makeExtraBodyOnPayload,
  type AgentMessage,
  type ResolvedModel,
} from '@aesyclaw/agent/agent-types';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type {
  MessagesRepository,
  UsageRepository,
  ToolUsageRepository,
} from '@aesyclaw/core/database/database-manager';
import { completeSimple, type AssistantMessage } from '@mariozechner/pi-ai';
import { createScopedLogger } from '@aesyclaw/core/logger';

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
        : createPersistedAssistantMessage(r.content, parseTimestamp(r.timestamp)),
    );
  }

  /**
   * 添加一条消息到会话。
   *
   * 消息会同时写入数据库持久化。
   * @param message - 要添加的消息
   */
  async add(message: AgentMessage): Promise<void> {
    await this.recordUsageIfApplicable(message);
    this._messages.push(message);

    const persistable = toPersistable(message);
    if (!persistable) return;

    await this.db.messages.save(this.sessionId, persistable);
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
    const model = llmAdapter.resolveModel(modelIdentifier);
    logger.info('正在压缩会话历史', {
      sessionId: this.sessionId,
      messageCount: this._messages.length,
      totalTokens: `${estimateApproximateTokens(this._messages)}/${model.contextWindow}`,
    });

    const { summary, message } = await this.summarizeConversation(model, this._messages);

    if (this.db.usage) {
      try {
        await this.db.usage.create({
          model: message.model,
          provider: message.provider,
          api: message.api,
          responseId: message.responseId,
          usage: message.usage,
        });
      } catch (err) {
        logger.error('记录压缩用量失败', err);
      }
    }

    await this.db.messages.replaceWithSummary(this.sessionId, summary);
    await this.bind();

    logger.info('会话历史已压缩', {
      sessionId: this.sessionId,
      summaryLength: summary.length,
    });

    return summary;
  }

  /**
   * 筛选符合条件的消息。
   * @param pred - 筛选谓词函数
   * @returns 匹配的消息数组
   */
  filter(pred: (msg: AgentMessage) => boolean): AgentMessage[] {
    return this._messages.filter(pred);
  }

  private async recordUsageIfApplicable(message: AgentMessage): Promise<void> {
    if (
      this.db.usage === undefined ||
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

  private async summarizeConversation(
    model: ResolvedModel,
    messages: AgentMessage[],
  ): Promise<{ summary: string; message: AssistantMessage }> {
    const prompt = buildSummaryPrompt(messages);

    const response = await completeSimple(
      model,
      {
        systemPrompt: [
          'You are a conversation archivist. Summarize the following dialogue into a compact record for future turns.',
          'Output ONLY the summary in the following structure, using plain text:',
          '',
          '## Previous Discussion',
          '- What has already been discussed with the user (topics, decisions made, conclusions reached)',
          '',
          '## Current Focus',
          '- What is being worked on or discussed right now (the active task or question)',
          '',
          '## Next Steps',
          '- What remains to be done, unresolved questions, or pending follow-ups',
          '',
          '## Notes',
          '- Special constraints, important facts, user preferences, tool results, file paths, or any context critical for continuity',
          '',
          'Keep each section concise. Do not mention that you are summarizing or refer to missing context.',
        ].join('\n'),
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      {
        apiKey: model.apiKey,
        sessionId: this.sessionId,
        onPayload: makeExtraBodyOnPayload(model),
      },
    );

    const summary = extractMessageText(response).trim();
    if (summary.length === 0) throw new Error('LLM 返回了空总结');
    return { summary, message: response };
  }
}

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

  return { role: message.role, content: text, timestamp: new Date().toISOString() };
}

function getPersistedAssistantTextFromToolResult(message: AgentMessage): string | null {
  if (message.role !== 'toolResult') return null;

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

function buildSummaryPrompt(messages: AgentMessage[]): string {
  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${extractMessageText(m).trim()}`)
    .filter((line) => !line.endsWith(':'))
    .join('\n\n');
  return ['Conversation transcript:', '', transcript].join('\n');
}
