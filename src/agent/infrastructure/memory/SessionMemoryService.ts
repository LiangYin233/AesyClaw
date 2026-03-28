import type { InboundMessage } from '../../../types.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import type { Session, SessionManager, SessionMessage } from '../../../features/sessions/application/SessionManager.js';
import type { ContextMode } from '../../../features/config/schema/index.js';
import {
  type LongTermMemoryEntry,
  type LongTermMemoryOperation,
  type MemoryOperationActor,
  type MemoryOperationInput,
  type MemoryOperationResult
} from '../../../features/sessions/infrastructure/LongTermMemoryStore.js';
import { logger } from '../../../platform/observability/index.js';
import { collectConversationRounds, sliceRecentConversationRounds } from './conversationRounds.js';
import { LongTermMemoryService } from './LongTermMemoryService.js';

const MEMORY_SUMMARY_PREFIX = '会话摘要（旧上下文）：';
const CRON_CHANNEL = 'cron';
const CRON_SESSION_KEY_PREFIX = `${CRON_CHANNEL}:`;

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

interface SummaryCompressionBatch {
  pendingMessages: SessionMessage[];
  summaryCutoff: number;
  remainingRounds: number;
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
    return sessionKey?.startsWith(CRON_SESSION_KEY_PREFIX) === true || session?.channel === CRON_CHANNEL;
  }

  async buildHistory(
    session: Session,
    request?: Pick<InboundMessage, 'content'> & Partial<Pick<InboundMessage, 'media' | 'files'>>
  ): Promise<SessionMessage[]> {
    if (this.shouldSkipMemory(session.key, session)) {
      return sliceRecentConversationRounds(session.messages, this.summaryConfig.memoryWindow);
    }

    if (this.summaryConfig.contextMode === 'channel') {
      return this.attachRecallMessage(session, request, await this.buildConversationHistory(session));
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

    return this.attachRecallMessage(session, request, [...summaryMessage, ...recentMessages]);
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

    try {
      const unsummarizedMessages = session.messages.slice(session.summarizedMessageCount);
      return (await this.summarizeUnsummarizedMessages(
        session.summary,
        unsummarizedMessages,
        async (summary, _pendingMessages, relativeSummaryCutoff, remainingRounds) => {
          const summarizedMessageCount = session.summarizedMessageCount + relativeSummaryCutoff;
          await this.sessionManager.updateSummary(sessionKey, summary, summarizedMessageCount);

          if (remainingRounds > this.summaryConfig.memoryWindow) {
          }
        }
      )).changed;
    } catch {
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

  private async attachRecallMessage(
    session: Session,
    request: Pick<InboundMessage, 'content'> & Partial<Pick<InboundMessage, 'media' | 'files'>> | undefined,
    history: SessionMessage[]
  ): Promise<SessionMessage[]> {
    if (!request || !this.longTermMemoryService) {
      return history;
    }

    const recallContent = await this.longTermMemoryService.buildRecallMessage(session.channel, session.chatId, request);
    if (!recallContent) {
      return history;
    }

    const insertIndex = history.findIndex((message) => message.role !== 'system');
    const recallMessage: SessionMessage = {
      role: 'system',
      content: recallContent
    };

    if (insertIndex === -1) {
      return [...history, recallMessage];
    }

    return [
      ...history.slice(0, insertIndex),
      recallMessage,
      ...history.slice(insertIndex)
    ];
  }

  private async maybeSummarizeConversation(session: Session): Promise<boolean> {
    const conversationMemory = await this.sessionManager.getConversationMemory(session.channel, session.chatId);
    const unsummarizedMessages = (await this.sessionManager.getConversationMessages(session.channel, session.chatId))
      .filter((message) => message.id > conversationMemory.summarizedUntilMessageId);

    try {
      const summaryMessages = unsummarizedMessages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp
      }));
      return (await this.summarizeUnsummarizedMessages(
        conversationMemory.summary,
        summaryMessages,
        async (summary, pendingMessages) => {
          const summarizedUntilMessageId = unsummarizedMessages[pendingMessages.length - 1]?.id || 0;
          await this.sessionManager.updateConversationSummary(
            session.channel,
            session.chatId,
            summary,
            summarizedUntilMessageId
          );
        }
      )).changed;
    } catch {
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

  private createSummaryCompressionBatch(unsummarizedMessages: SessionMessage[]): SummaryCompressionBatch | null {
    const unsummarizedRounds = collectConversationRounds(unsummarizedMessages);
    if (unsummarizedRounds.length <= this.summaryConfig.memoryWindow) {
      return null;
    }

    const roundsToCompress = unsummarizedRounds.slice(0, this.summaryConfig.compressRounds);
    if (roundsToCompress.length === 0) {
      return null;
    }

    const summaryCutoff = roundsToCompress[roundsToCompress.length - 1].end;
    const pendingMessages = unsummarizedMessages.slice(0, summaryCutoff);
    if (pendingMessages.length === 0) {
      return null;
    }

    return {
      pendingMessages,
      summaryCutoff,
      remainingRounds: unsummarizedRounds.length - roundsToCompress.length
    };
  }

  private async summarizeUnsummarizedMessages(
    existingSummary: string,
    unsummarizedMessages: SessionMessage[],
    persist: (
      summary: string,
      pendingMessages: SessionMessage[],
      summaryCutoff: number,
      remainingRounds: number
    ) => Promise<void>
  ): Promise<{ changed: boolean; remainingRounds: number }> {
    const batch = this.createSummaryCompressionBatch(unsummarizedMessages);
    if (!batch) {
      return { changed: false, remainingRounds: 0 };
    }

    const summary = await this.generateSummary(existingSummary, batch.pendingMessages);
    if (!summary) {
      return { changed: false, remainingRounds: batch.remainingRounds };
    }

    await persist(summary, batch.pendingMessages, batch.summaryCutoff, batch.remainingRounds);
    return {
      changed: true,
      remainingRounds: batch.remainingRounds
    };
  }
}
