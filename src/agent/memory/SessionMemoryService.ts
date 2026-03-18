import type { InboundMessage } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { Session, SessionManager, SessionMessage } from '../../session/SessionManager.js';
import type { ContextMode } from '../types.js';
import {
  type LongTermMemoryEntry,
  type LongTermMemoryOperation,
  type MemoryOperationActor,
  type MemoryOperationInput,
  type MemoryOperationResult
} from '../../session/LongTermMemoryStore.js';
import { logger } from '../../observability/index.js';
import { CRON_SESSION_KEY_PREFIX, INTERNAL_CHANNELS } from '../../constants/index.js';
import { collectConversationRounds, sliceRecentConversationRounds } from './conversationRounds.js';
import { LongTermMemoryService } from './LongTermMemoryService.js';

const MEMORY_SUMMARY_PREFIX = '会话摘要（旧上下文）：';

const SUMMARY_SYSTEM_PROMPT = [
  '角色: 对话摘要器',
  '任务: 将历史对话压缩成简洁摘要，并与已有摘要合并。',
  '核心要求: 这是“对话内容摘要”，不是写给用户的新回复。要概括对话中讨论了什么、用户表达了什么、助手给出了什么关键结论、当前进展到哪里。',
  '保留: 用户偏好、身份背景、长期目标、当前任务、关键结论、已确认事实、未完成事项、下一步。',
  '忽略: 寒暄、重复表述、低价值细节、纯客套语。',
  '约束: 不编造；纯文本；不使用标题；尽量简短但信息完整。',
  '输出: 新的完整对话摘要。'
].join('\n');

function buildSummaryUserPrompt(existingSummary: string, transcript: string): string {
  return [
    `已有摘要:\n${existingSummary || '(无)'}`,
    `需要压缩并合并的新增对话:\n${transcript || '(无新增对话)'}`,
    '请输出合并后的完整对话摘要。'
  ].join('\n\n');
}

interface MemorySummaryRuntimeConfig {
  enabled: boolean;
  model?: string;
  compressRounds: number;
  memoryWindow: number;
  contextMode: ContextMode;
}

export class SessionMemoryService {
  private log = logger.child('SessionMemory');

  constructor(
    private sessionManager: SessionManager,
    private summaryProvider: LLMProvider | undefined,
    private summaryConfig: MemorySummaryRuntimeConfig,
    private longTermMemoryService?: LongTermMemoryService
  ) {}

  hasLongTermMemory(): boolean {
    return !!this.longTermMemoryService?.isEnabled();
  }

  async listLongTermMemory(channel: string, chatId: string): Promise<LongTermMemoryEntry[]> {
    return this.longTermMemoryService?.listEntries(channel, chatId) || [];
  }

  async listLongTermMemoryOperations(channel: string, chatId: string, limit = 10): Promise<LongTermMemoryOperation[]> {
    return this.longTermMemoryService?.listRecentOperations(channel, chatId, limit) || [];
  }

  async applyLongTermMemoryOperations(
    channel: string,
    chatId: string,
    operations: MemoryOperationInput[],
    actor: MemoryOperationActor
  ): Promise<MemoryOperationResult[]> {
    if (!this.longTermMemoryService) {
      throw new Error('Long-term memory service is not enabled');
    }

    return this.longTermMemoryService.applyOperations(channel, chatId, operations, actor);
  }

  private shouldSkipMemory(sessionKey?: string, session?: Pick<Session, 'channel'>): boolean {
    return sessionKey?.startsWith(CRON_SESSION_KEY_PREFIX) === true || session?.channel === INTERNAL_CHANNELS.CRON;
  }

  async buildHistory(session: Session): Promise<SessionMessage[]> {
    if (this.shouldSkipMemory(session.key, session)) {
      return sliceRecentConversationRounds(session.messages, this.summaryConfig.memoryWindow);
    }

    if (this.summaryConfig.contextMode === 'channel') {
      return this.buildConversationHistory(session);
    }

    const summaryMessage = session.summary.trim()
      ? [{
          role: 'system' as const,
          content: `${MEMORY_SUMMARY_PREFIX}\n${session.summary.trim()}`
        }]
      : [];

    const recentMessages = sliceRecentConversationRounds(
      session.messages,
      this.summaryConfig.memoryWindow,
      session.summarizedMessageCount
    );

    return [...summaryMessage, ...recentMessages];
  }

  async maybeSummarizeSession(sessionKey: string): Promise<boolean> {
    if (!this.summaryConfig.enabled || !this.summaryProvider || !this.summaryConfig.model) {
      return false;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    if (this.shouldSkipMemory(sessionKey, session)) {
      return false;
    }

    if (this.summaryConfig.contextMode === 'channel') {
      return this.maybeSummarizeConversation(session);
    }

    const unsummarizedRounds = collectConversationRounds(session.messages, session.summarizedMessageCount);
    if (unsummarizedRounds.length <= this.summaryConfig.memoryWindow) {
      return false;
    }

    const roundsToCompress = unsummarizedRounds.slice(0, this.summaryConfig.compressRounds);
    if (roundsToCompress.length === 0) {
      return false;
    }

    const summaryCutoff = roundsToCompress[roundsToCompress.length - 1].end;
    const pendingMessages = session.messages.slice(session.summarizedMessageCount, summaryCutoff);

    if (pendingMessages.length === 0) {
      return false;
    }

    try {
      const summary = await this.generateSummary(session.summary, pendingMessages);
      if (!summary) {
        return false;
      }

      await this.sessionManager.updateSummary(sessionKey, summary, summaryCutoff);
      this.log.info('会话摘要已更新', { sessionKey, summarizedMessageCount: summaryCutoff });

      const remainingRounds = unsummarizedRounds.length - roundsToCompress.length;
      if (remainingRounds > this.summaryConfig.memoryWindow) {
        this.log.warn('摘要压缩轮数不足，无法收敛到 memoryWindow 内', {
          sessionKey,
          memoryWindow: this.summaryConfig.memoryWindow,
          compressRounds: this.summaryConfig.compressRounds,
          remainingRounds
        });
      }

      return true;
    } catch (error) {
      this.log.warn('会话摘要生成失败', { sessionKey, error });
      return false;
    }
  }

  private async buildConversationHistory(session: Session): Promise<SessionMessage[]> {
    const conversationMemory = await this.sessionManager.getConversationMemory(session.channel, session.chatId);
    const summaryMessage = conversationMemory.summary.trim()
      ? [{
          role: 'system' as const,
          content: `${MEMORY_SUMMARY_PREFIX}\n${conversationMemory.summary.trim()}`
        }]
      : [];

    const recentMessages = sliceRecentConversationRounds(
      (await this.sessionManager.getConversationMessages(session.channel, session.chatId))
        .filter((message) => message.id > conversationMemory.summarizedUntilMessageId)
        .map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: message.timestamp
        })),
      this.summaryConfig.memoryWindow
    );

    return [...summaryMessage, ...recentMessages];
  }

  private async maybeSummarizeConversation(session: Session): Promise<boolean> {
    const conversationMemory = await this.sessionManager.getConversationMemory(session.channel, session.chatId);
    const unsummarizedMessages = (await this.sessionManager.getConversationMessages(session.channel, session.chatId))
      .filter((message) => message.id > conversationMemory.summarizedUntilMessageId);
    const unsummarizedRounds = collectConversationRounds(unsummarizedMessages);

    if (unsummarizedRounds.length <= this.summaryConfig.memoryWindow) {
      return false;
    }

    const roundsToCompress = unsummarizedRounds.slice(0, this.summaryConfig.compressRounds);
    if (roundsToCompress.length === 0) {
      return false;
    }

    const summaryCutoff = roundsToCompress[roundsToCompress.length - 1].end;
    const pendingMessages = unsummarizedMessages.slice(0, summaryCutoff);
    if (pendingMessages.length === 0) {
      return false;
    }

    try {
      const summary = await this.generateSummary(
        conversationMemory.summary,
        pendingMessages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: message.timestamp
        }))
      );
      if (!summary) {
        return false;
      }

      const summarizedUntilMessageId = pendingMessages[pendingMessages.length - 1]?.id || 0;
      await this.sessionManager.updateConversationSummary(
        session.channel,
        session.chatId,
        summary,
        summarizedUntilMessageId
      );
      this.log.info('对话摘要已更新', {
        channel: session.channel,
        chatId: session.chatId,
        summarizedUntilMessageId
      });
      return true;
    } catch (error) {
      this.log.warn('对话摘要生成失败', {
        channel: session.channel,
        chatId: session.chatId,
        error
      });
      return false;
    }
  }

  enqueueLongTermMemoryMaintenance(
    sessionKey: string,
    request: Pick<InboundMessage, 'content'> & Partial<Pick<InboundMessage, 'media' | 'files'>>,
    assistantContent: string
  ): void {
    if (!this.longTermMemoryService || this.shouldSkipMemory(sessionKey)) {
      return;
    }

    this.longTermMemoryService.enqueueMaintenance(sessionKey, request, assistantContent);
  }

  private async generateSummary(existingSummary: string, messages: SessionMessage[]): Promise<string | null> {
    const transcript = messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => `${message.role === 'user' ? '用户' : '助手'}: ${message.content}`)
      .join('\n\n');

    if (!transcript.trim()) {
      return null;
    }

    const response = await this.summaryProvider!.chat([
      {
        role: 'system',
        content: SUMMARY_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: buildSummaryUserPrompt(existingSummary, transcript)
      }
    ], undefined, this.summaryConfig.model, { reasoning: false });

    return response.content?.trim() || null;
  }
}
