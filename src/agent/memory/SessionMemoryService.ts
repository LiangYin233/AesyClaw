import type { LLMProvider } from '../../providers/base.js';
import type { Session, SessionManager, SessionMessage } from '../../session/SessionManager.js';
import { MemoryFactStore, type MemoryFact } from '../../session/MemoryFactStore.js';
import { logger } from '../../logger/index.js';
import {
  MEMORY_FACTS_PREFIX,
  MEMORY_SUMMARY_PREFIX,
  SUMMARY_SYSTEM_PROMPT,
  FACTS_SYSTEM_PROMPT,
  buildSummaryUserPrompt,
  buildFactsUserPrompt
} from '../prompts.js';

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

  async buildHistory(session: Session): Promise<SessionMessage[]> {
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
    const summaryCutoff = Math.max(0, session.messages.length - this.summaryConfig.memoryWindow);
    const pendingMessages = session.messages.slice(session.summarizedMessageCount, summaryCutoff);

    if (pendingMessages.length < this.summaryConfig.triggerMessages) {
      return false;
    }

    try {
      const summary = await this.generateSummary(session.summary, pendingMessages);
      if (!summary) {
        return false;
      }

      await this.sessionManager.updateSummary(sessionKey, summary, summaryCutoff);
      this.log.info(`Updated summary for session ${sessionKey}, summarized messages: ${summaryCutoff}`);
      return true;
    } catch (error) {
      this.log.warn(`Failed to summarize session ${sessionKey}:`, error);
      return false;
    }
  }

  async maybePersistMemory(sessionKey: string, userContent: string, assistantContent: string): Promise<void> {
    await this.maybeExtractFacts(sessionKey, userContent, assistantContent);
    await this.maybeSummarizeSession(sessionKey);
  }

  private async generateSummary(existingSummary: string, messages: SessionMessage[]): Promise<string | null> {
    const transcript = messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n\n');

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

  private async maybeExtractFacts(sessionKey: string, userContent: string, assistantContent: string): Promise<void> {
    if (!this.factsConfig?.enabled || !this.factsProvider) {
      return;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    const existingFacts = await this.factsStore.getFacts(session.channel, session.chatId);
    const extractedFacts = await this.extractFacts(existingFacts, userContent, assistantContent);

    if (extractedFacts.length === 0) {
      return;
    }

    const mergedFacts = Array.from(new Set([
      ...extractedFacts,
      ...existingFacts.map((fact) => fact.content)
    ])).slice(0, this.factsConfig.maxFacts);

    await this.factsStore.setFacts(session.channel, session.chatId, mergedFacts);
    this.log.info(`Updated facts for ${session.channel}:${session.chatId}, total facts: ${mergedFacts.length}`);
  }

  private async extractFacts(existingFacts: MemoryFact[], userContent: string, assistantContent: string): Promise<string[]> {
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
        content: buildFactsUserPrompt(existingFactsBlock, userContent, assistantContent)
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
