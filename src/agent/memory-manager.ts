/**
 * MemoryManager — manages conversation history for a session.
 *
 * Responsibilities:
 * - Load persisted messages from the database and convert to AgentMessage format
 * - Persist messages from agent state with filtering strategy (§5.7.3)
 * - Compact history via LLM summarization when it grows too long
 * - Clear session history
 *
 * Filtering strategy (per project.md §5.7.3):
 * - `role === 'user'` → always save
 * - `role === 'assistant'` with NO toolCalls → save
 * - `role === 'assistant'` WITH toolCalls → skip (internal reasoning, not user-visible)
 * - `role === 'toolResult'` → skip (internal results)
 * - Empty content → skip
 *
 * @see project.md §5.7.3
 */

import type { MessageRepository } from '../core/database/repositories/message-repository';
import {
  assistantHasToolCalls,
  createPersistedAssistantMessage,
  createUserMessage,
  extractMessageText,
} from './agent-types';
import type { AgentMessage, MemoryConfig } from './agent-types';
import type { LlmAdapter } from './llm-adapter';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('memory');

// ─── MemoryManager ──────────────────────────────────────────────

export class MemoryManager {
  private readonly sessionId: string;
  private readonly messageRepo: MessageRepository;
  private readonly config: MemoryConfig;

  constructor(sessionId: string, messageRepo: MessageRepository, config: MemoryConfig) {
    this.sessionId = sessionId;
    this.messageRepo = messageRepo;
    this.config = config;
  }

  // ─── Read ──────────────────────────────────────────────────────

  /**
   * Load conversation history from the database and convert to AgentMessage format.
   *
   * Converts PersistableMessage records (which only have role + content)
   * into AgentMessage objects suitable for the agent.
   *
   * @returns Array of AgentMessage representing the session's history
   */
  async loadHistory(): Promise<AgentMessage[]> {
    const records = await this.messageRepo.loadHistory(this.sessionId);

    return records.map((record) =>
      record.role === 'user'
        ? createUserMessage(record.content, this.parseTimestamp(record.timestamp))
        : createPersistedAssistantMessage(record.content, this.parseTimestamp(record.timestamp)),
    );
  }

  // ─── Write ────────────────────────────────────────────────────

  /**
   * Persist a single AgentMessage to the database, applying the filtering strategy.
   *
   * Filtering rules (§5.7.3):
   * - Skip assistant messages that contain toolCalls (internal reasoning)
   * - Skip toolResult messages (internal results)
   * - Skip messages with empty content
   * - Always save user messages
   * - Save assistant messages that are pure text (no toolCalls)
   *
   * @param message - The AgentMessage to potentially persist
   */
  async persistMessage(message: AgentMessage): Promise<void> {
    // Skip toolResult messages
    if (message.role === 'toolResult') {
      return;
    }

    // Skip assistant messages that contain tool calls
    if (message.role === 'assistant' && assistantHasToolCalls(message)) {
      return;
    }

    const text = extractMessageText(message).trim();

    if (text.length === 0) {
      return;
    }

    await this.messageRepo.save(this.sessionId, {
      role: message.role as 'user' | 'assistant',
      content: text,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sync all messages from an agent's state into the database.
   *
   * Iterates through agent messages and applies the filtering strategy
   * via persistMessage for each one.
   *
   * @param agentMessages - The current messages from the agent's state
   */
  async syncFromAgent(agentMessages: AgentMessage[]): Promise<void> {
    let persisted = 0;
    let filtered = 0;

    for (const message of agentMessages) {
      if (this.shouldPersist(message)) {
        await this.persistMessage(message);
        persisted++;
      } else {
        filtered++;
      }
    }

    logger.debug(`Synced ${agentMessages.length} messages: ${persisted} persisted, ${filtered} filtered`);
  }

  // ─── Compact ──────────────────────────────────────────────────

  /**
   * Compact the session's conversation history by summarizing it via LLM.
   *
   * Flow:
   * 1. Load current history from DB
   * 2. If too few messages (≤ 2), skip — too short to compress
   * 3. Call llmAdapter.summarize to generate a summary
   * 4. Replace the session's messages with the summary in DB
   * 5. Return the summary
   *
   * @param llmAdapter - The LLM adapter for summarization
   * @returns The generated summary, or a skip message if too short
   */
  async compact(llmAdapter: LlmAdapter): Promise<string> {
    const messages = await this.loadHistory();

    if (messages.length <= 2) {
      logger.info('Session history too short to compress', {
        sessionId: this.sessionId,
        messageCount: messages.length,
      });
      return 'Session history too short to compress.';
    }

    logger.info('Compacting session history', {
      sessionId: this.sessionId,
      messageCount: messages.length,
    });

    const summary = await llmAdapter.summarize(messages);

    await this.messageRepo.replaceWithSummary(this.sessionId, summary);

    logger.info('Session history compacted', {
      sessionId: this.sessionId,
      originalMessages: messages.length,
      summaryLength: summary.length,
    });

    return summary;
  }

  // ─── Clear ────────────────────────────────────────────────────

  /**
   * Clear all session history from the database.
   */
  async clear(): Promise<void> {
    await this.messageRepo.clearHistory(this.sessionId);
    logger.info('Session history cleared', { sessionId: this.sessionId });
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Check if a message should be persisted based on the filtering strategy.
   */
  private shouldPersist(message: AgentMessage): boolean {
    // Never persist tool result messages
    if (message.role === 'toolResult') return false;

    // Never persist assistant messages with tool calls
    if (message.role === 'assistant' && assistantHasToolCalls(message)) {
      return false;
    }

    if (extractMessageText(message).trim().length === 0) return false;

    // Persist user messages and pure-text assistant messages
    return true;
  }

  private parseTimestamp(timestamp?: string): number {
    if (!timestamp) {
      return Date.now();
    }

    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
}
