import type { LongTermMemoryOperation } from '../sessions/infrastructure/LongTermMemoryStore.js';
import { NotFoundError } from '../../platform/errors/index.js';
import { MemoryRepository } from './MemoryRepository.js';

type MemoryItem = {
  key: string;
  channel: string;
  chatId: string;
  activeEntryCount: number;
  entries: Array<{
    id: number;
    kind: string;
    content: string;
    status: string;
    confidence: number;
    confirmations: number;
    createdAt?: string;
    updatedAt?: string;
    lastSeenAt?: string;
  }>;
  recentOperations: Array<{
    id: number;
    entryId?: number;
    action: string;
    actor: string;
    reason?: string;
    before?: unknown;
    after?: unknown;
    evidence: string[];
    createdAt?: string;
  }>;
  sessionCount: number;
  summaryCount: number;
  conversationSummary?: string;
  conversationSummarizedUntilMessageId?: number;
  sessions: Array<{
    sessionKey: string;
    uuid?: string;
    summary: string;
    summarizedMessageCount: number;
    updatedAt?: string;
  }>;
  updatedAt?: string;
};

export class MemoryApiService {
  constructor(private readonly repository: MemoryRepository) {}

  async listMemory(): Promise<{ items: MemoryItem[] }> {
    const { sessionRows, entryRows, operationRows, conversationRows } = await this.repository.listMemoryRows();

    const entriesByConversation = new Map<string, MemoryItem['entries']>();
    for (const row of entryRows) {
      const key = `${row.channel}:${row.chat_id}`;
      const bucket = entriesByConversation.get(key) || [];
      bucket.push({
        id: row.id,
        kind: row.kind,
        content: row.content,
        status: row.status,
        confidence: row.confidence,
        confirmations: row.confirmations,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastSeenAt: row.last_seen_at
      });
      entriesByConversation.set(key, bucket);
    }

    const operationsByConversation = new Map<string, MemoryItem['recentOperations']>();
    for (const row of operationRows) {
      const key = `${row.channel}:${row.chat_id}`;
      const bucket = operationsByConversation.get(key) || [];
      if (bucket.length >= 20) {
        continue;
      }

      bucket.push({
        id: row.id,
        entryId: row.entry_id ?? undefined,
        action: row.action,
        actor: row.actor,
        reason: row.reason || undefined,
        before: this.parseJson(row.before_json),
        after: this.parseJson(row.after_json),
        evidence: this.parseJson<string[]>(row.evidence_json) || [],
        createdAt: row.created_at
      });
      operationsByConversation.set(key, bucket);
    }

    const conversationMap = new Map<string, MemoryItem>();

    for (const row of sessionRows) {
      const conversationKey = `${row.channel}:${row.chat_id}`;
      const existingEntries = entriesByConversation.get(conversationKey) || [];
      const existing = conversationMap.get(conversationKey) || {
        key: `memory:${conversationKey}`,
        channel: row.channel,
        chatId: row.chat_id,
        activeEntryCount: existingEntries.filter((entry) => entry.status === 'active').length,
        entries: existingEntries,
        recentOperations: operationsByConversation.get(conversationKey) || [],
        sessionCount: 0,
        summaryCount: 0,
        sessions: [],
        updatedAt: this.getLatestTimestamp(
          ...existingEntries.map((entry) => entry.updatedAt),
          ...(operationsByConversation.get(conversationKey) || []).map((operation) => operation.createdAt)
        )
      };

      existing.sessionCount += 1;
      if (row.summary.trim()) {
        existing.summaryCount += 1;
      }
      existing.sessions.push({
        sessionKey: row.key,
        uuid: row.uuid || undefined,
        summary: row.summary,
        summarizedMessageCount: row.summarized_message_count,
        updatedAt: this.getLatestTimestamp(row.summary_updated_at, row.session_updated_at)
      });
      existing.updatedAt = this.getLatestTimestamp(existing.updatedAt, row.summary_updated_at, row.session_updated_at);
      conversationMap.set(conversationKey, existing);
    }

    for (const row of conversationRows) {
      const conversationKey = `${row.channel}:${row.chat_id}`;
      const existingEntries = entriesByConversation.get(conversationKey) || [];
      const existing = conversationMap.get(conversationKey) || {
        key: `memory:${conversationKey}`,
        channel: row.channel,
        chatId: row.chat_id,
        activeEntryCount: existingEntries.filter((entry) => entry.status === 'active').length,
        entries: existingEntries,
        recentOperations: operationsByConversation.get(conversationKey) || [],
        sessionCount: 0,
        summaryCount: 0,
        sessions: [],
        updatedAt: this.getLatestTimestamp(
          ...existingEntries.map((entry) => entry.updatedAt),
          ...(operationsByConversation.get(conversationKey) || []).map((operation) => operation.createdAt)
        )
      };

      if (row.summary.trim()) {
        existing.summaryCount += 1;
        existing.conversationSummary = row.summary;
        existing.conversationSummarizedUntilMessageId = row.summarized_until_message_id;
      }
      existing.updatedAt = this.getLatestTimestamp(existing.updatedAt, row.updated_at);
      conversationMap.set(conversationKey, existing);
    }

    for (const [conversationKey, entries] of entriesByConversation.entries()) {
      if (conversationMap.has(conversationKey)) {
        continue;
      }

      const separatorIndex = conversationKey.indexOf(':');
      const channel = conversationKey.slice(0, separatorIndex);
      const chatId = conversationKey.slice(separatorIndex + 1);
      conversationMap.set(conversationKey, {
        key: `memory:${conversationKey}`,
        channel,
        chatId,
        activeEntryCount: entries.filter((entry) => entry.status === 'active').length,
        entries,
        recentOperations: operationsByConversation.get(conversationKey) || [],
        sessionCount: 0,
        summaryCount: 0,
        sessions: [],
        updatedAt: this.getLatestTimestamp(
          ...entries.map((entry) => entry.updatedAt),
          ...(operationsByConversation.get(conversationKey) || []).map((operation) => operation.createdAt)
        )
      });
    }

    const items = Array.from(conversationMap.values())
      .filter((item) => item.activeEntryCount > 0 || item.summaryCount > 0 || item.entries.length > 0 || item.recentOperations.length > 0)
      .map((item) => ({
        ...item,
        sessions: item.sessions.sort((left, right) => this.toTimestamp(right.updatedAt) - this.toTimestamp(left.updatedAt))
      }));

    items.sort((left, right) => this.toTimestamp(right.updatedAt) - this.toTimestamp(left.updatedAt));

    return { items };
  }

  async getHistory(rawKey: string): Promise<{ items: LongTermMemoryOperation[] }> {
    const { channel, chatId } = await this.resolveConversationTarget(rawKey);
    const items = await this.repository.listOperations(channel, chatId, 100);
    return { items };
  }

  async deleteConversation(rawKey: string): Promise<{ success: true; deletedCount: number }> {
    const { channel, chatId } = await this.resolveConversationTarget(rawKey);
    const deletedCount = await this.repository.clearConversation(channel, chatId);

    return {
      success: true,
      deletedCount
    };
  }

  async deleteAll(): Promise<{ success: true; deletedCount: number }> {
    const deletedCount = await this.repository.clearAll();
    return {
      success: true,
      deletedCount
    };
  }

  private async resolveConversationTarget(rawKey: string): Promise<{ channel: string; chatId: string }> {
    const target = await this.repository.resolveConversationTarget(rawKey);
    if (!target) {
      throw new NotFoundError('Memory entry', rawKey);
    }
    return target;
  }

  private parseJson<T>(value?: string | null): T | undefined {
    if (!value) {
      return undefined;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }

  private getLatestTimestamp(...values: Array<string | null | undefined>): string | undefined {
    const timestamps = values.filter((value): value is string => Boolean(value));
    if (timestamps.length === 0) {
      return undefined;
    }

    return timestamps.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  }

  private toTimestamp(value?: string): number {
    return value ? new Date(value).getTime() : 0;
  }
}
