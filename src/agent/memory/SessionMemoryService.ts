import type { InboundMessage } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { Session, SessionManager, SessionMessage } from '../../session/SessionManager.js';
import { MemoryFactStore, type MemoryFact } from '../../session/MemoryFactStore.js';
import { logger } from '../../logger/index.js';
import { CRON_SESSION_KEY_PREFIX, INTERNAL_CHANNELS } from '../../constants/index.js';
import {
  MEMORY_FACTS_PREFIX,
  MEMORY_SUMMARY_PREFIX,
  SUMMARY_SYSTEM_PROMPT,
  FACTS_SYSTEM_PROMPT,
  buildSummaryUserPrompt,
  buildFactsUserPrompt
} from '../execution/engine/prompts.js';

interface MemorySummaryRuntimeConfig {
  enabled: boolean;
  model?: string;
  triggerMessages: number;
  memoryWindow: number;
}

interface MemoryFactsRuntimeConfig {
  enabled: boolean;
  model?: string;
  maxFacts: number;
}

export class SessionMemoryService {
  private log = logger.child({ prefix: 'SessionMemory' });

  constructor(
    private sessionManager: SessionManager,
    private factsStore: MemoryFactStore,
    private summaryProvider: LLMProvider | undefined,
    private summaryConfig: MemorySummaryRuntimeConfig,
    private factsProvider?: LLMProvider,
    private factsConfig?: MemoryFactsRuntimeConfig
  ) {}

  private shouldSkipMemory(sessionKey?: string, session?: Pick<Session, 'channel'>): boolean {
    return sessionKey?.startsWith(CRON_SESSION_KEY_PREFIX) === true || session?.channel === INTERNAL_CHANNELS.CRON;
  }

  private alignSummaryCutoff(messages: SessionMessage[], startIndex: number, rawCutoff: number): number {
    let cutoff = Math.max(startIndex, Math.min(rawCutoff, messages.length));

    while (cutoff < messages.length) {
      const lastMessage = messages[cutoff - 1];
      const nextMessage = messages[cutoff];

      if (lastMessage?.role === 'user' && nextMessage?.role === 'assistant') {
        cutoff += 1;
        continue;
      }

      break;
    }

    return cutoff;
  }

  async buildHistory(session: Session): Promise<SessionMessage[]> {
    if (this.shouldSkipMemory(session.key, session)) {
      return session.messages.slice(-this.summaryConfig.memoryWindow);
    }

    const facts = await this.factsStore.getFacts(session.channel, session.chatId);
    const factMessage = this.buildFactsMessage(facts);
    const summaryMessage = session.summary.trim()
      ? [{
          role: 'system' as const,
          content: `${MEMORY_SUMMARY_PREFIX}\n${session.summary.trim()}`
        }]
      : [];

    const recentStart = Math.max(
      session.summarizedMessageCount,
      session.messages.length - this.summaryConfig.memoryWindow,
      0
    );

    return [...factMessage, ...summaryMessage, ...session.messages.slice(recentStart)];
  }

  async maybeSummarizeSession(sessionKey: string): Promise<boolean> {
    if (!this.summaryConfig.enabled || !this.summaryProvider) {
      return false;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    if (this.shouldSkipMemory(sessionKey, session)) {
      return false;
    }

    const unsummarizedMessageCount = Math.max(0, session.messages.length - session.summarizedMessageCount);
    const overflowMessageCount = Math.max(0, unsummarizedMessageCount - this.summaryConfig.memoryWindow);

    if (overflowMessageCount < this.summaryConfig.triggerMessages) {
      return false;
    }

    const rawCutoff = session.summarizedMessageCount + overflowMessageCount;
    const summaryCutoff = this.alignSummaryCutoff(session.messages, session.summarizedMessageCount, rawCutoff);
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
      this.log.info('Session summary updated', { sessionKey, summarizedMessageCount: summaryCutoff });
      return true;
    } catch (error) {
      this.log.warn('Session summarization failed', { sessionKey, error });
      return false;
    }
  }

  async maybePersistMemory(sessionKey: string, userContent: string, _assistantContent: string): Promise<void> {
    const request: InboundMessage = {
      channel: '',
      senderId: '',
      chatId: '',
      content: userContent,
      timestamp: new Date()
    };
    return this.maybePersistMemoryForRequest(sessionKey, request, _assistantContent);
  }

  async maybePersistMemoryForRequest(sessionKey: string, request: Pick<InboundMessage, 'content' | 'media' | 'files'>, _assistantContent: string): Promise<void> {
    if (this.shouldSkipMemory(sessionKey)) {
      return;
    }

    const hasText = request.content.trim().length > 0;
    const hasMedia = Array.isArray(request.media) && request.media.length > 0;
    const hasFiles = Array.isArray(request.files) && request.files.length > 0;

    if (!hasText && hasMedia && !hasFiles) {
      this.log.debug('Skip memory persistence for pure image message', { sessionKey, mediaCount: request.media?.length || 0 });
      return;
    }

    await this.maybeExtractFacts(sessionKey, request.content);
    await this.maybeSummarizeSession(sessionKey);
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

  private buildFactsMessage(facts: MemoryFact[]): SessionMessage[] {
    if (facts.length === 0) {
      return [];
    }

    return [{
      role: 'system',
      content: [
        MEMORY_FACTS_PREFIX,
        ...facts.map((fact, index) => `${index + 1}. ${fact.content}`)
      ].join('\n')
    }];
  }

  private async maybeExtractFacts(sessionKey: string, userContent: string): Promise<void> {
    if (!this.factsConfig?.enabled || !this.factsProvider) {
      return;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    if (this.shouldSkipMemory(sessionKey, session)) {
      return;
    }

    const existingFacts = await this.factsStore.getFacts(session.channel, session.chatId);
    const extractedFacts = await this.extractFacts(existingFacts, userContent);

    if (extractedFacts.length === 0) {
      return;
    }

    await this.factsStore.upsertFacts(session.channel, session.chatId, extractedFacts, this.factsConfig.maxFacts);
    const persistedFacts = await this.factsStore.getFacts(session.channel, session.chatId);
    this.log.info('Session facts updated', { channel: session.channel, chatId: session.chatId, factCount: persistedFacts.length });
  }

  private async extractFacts(existingFacts: MemoryFact[], userContent: string): Promise<string[]> {
    const existingFactsBlock = existingFacts.length > 0
      ? existingFacts.map((fact, index) => `${index + 1}. ${fact.content}`).join('\n')
      : '(无)';

    const response = await this.factsProvider!.chat([
      {
        role: 'system',
        content: FACTS_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: buildFactsUserPrompt(existingFactsBlock, userContent)
      }
    ], undefined, this.factsConfig?.model, { reasoning: false });

    const raw = response.content?.trim() || '';
    if (!raw || raw === '无') {
      return [];
    }

    return raw
      .split('\n')
      .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
      .filter((line) => line.length > 0 && line !== '无');
  }
}
