import { type Database, type DBMemoryFact } from '../db/index.js';
import { formatLocalTimestamp } from '../observability/logging.js';

export interface MemoryFact {
  content: string;
  createdAt?: string;
  updatedAt?: string;
  lastSeenAt?: string;
  confidence?: number;
  confirmations?: number;
}

export class MemoryFactStore {
  private facts: Map<string, MemoryFact[]> = new Map();
  private static readonly MAX_CONFIDENCE = 10;

  constructor(private db: Database) {}

  private createConversationKey(channel: string, chatId: string): string {
    return `${channel}:${chatId}`;
  }

  private async loadFacts(channel: string, chatId: string): Promise<MemoryFact[]> {
    const rows = await this.db.all<DBMemoryFact>(
      `SELECT * FROM memory_facts
       WHERE channel = ? AND chat_id = ?
       ORDER BY confidence DESC, datetime(last_seen_at) DESC, datetime(updated_at) DESC, id DESC`,
      [channel, chatId]
    );

    return rows.map((row) => ({
      content: row.fact,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastSeenAt: row.last_seen_at,
      confidence: row.confidence,
      confirmations: row.confirmations
    }));
  }

  async getFacts(channel: string, chatId: string): Promise<MemoryFact[]> {
    const conversationKey = this.createConversationKey(channel, chatId);
    const cached = this.facts.get(conversationKey);
    if (cached) {
      return cached;
    }

    const facts = await this.loadFacts(channel, chatId);
    this.facts.set(conversationKey, facts);
    return facts;
  }

  async upsertFacts(channel: string, chatId: string, facts: string[], maxFacts: number): Promise<void> {
    const conversationKey = this.createConversationKey(channel, chatId);
    const normalizedFacts = Array.from(new Set(
      facts.map((fact) => fact.trim()).filter(Boolean)
    ));

    if (normalizedFacts.length === 0) {
      return;
    }

    const updatedAt = formatLocalTimestamp(new Date());

    await this.db.transaction(async () => {
      for (const fact of normalizedFacts) {
        const result = await this.db.run(
          `UPDATE memory_facts
           SET updated_at = ?,
               last_seen_at = ?,
               confidence = MIN(confidence + 1, ?),
               confirmations = confirmations + 1
           WHERE channel = ? AND chat_id = ? AND fact = ?`,
          [updatedAt, updatedAt, MemoryFactStore.MAX_CONFIDENCE, channel, chatId, fact]
        );

        if (result.changes === 0) {
          await this.db.run(
            `INSERT INTO memory_facts (
              channel, chat_id, fact, created_at, updated_at, last_seen_at, confidence, confirmations
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [channel, chatId, fact, updatedAt, updatedAt, updatedAt, 1, 1]
          );
        }
      }

      const rows = await this.db.all<Pick<DBMemoryFact, 'id'>>(
        `SELECT id FROM memory_facts
         WHERE channel = ? AND chat_id = ?
         ORDER BY confidence DESC, datetime(last_seen_at) DESC, datetime(updated_at) DESC, id DESC`,
        [channel, chatId]
      );

      const removableIds = rows.slice(maxFacts).map((row) => row.id);
      for (const factId of removableIds) {
        await this.db.run(`DELETE FROM memory_facts WHERE id = ?`, [factId]);
      }
    });

    const refreshedFacts = await this.loadFacts(channel, chatId);
    this.facts.set(conversationKey, refreshedFacts);
  }

  async clearFacts(channel: string, chatId: string): Promise<void> {
    const conversationKey = this.createConversationKey(channel, chatId);
    await this.db.run(
      `DELETE FROM memory_facts WHERE channel = ? AND chat_id = ?`,
      [channel, chatId]
    );
    this.facts.delete(conversationKey);
  }

  async clearAllFacts(): Promise<void> {
    await this.db.run(`DELETE FROM memory_facts`);
    this.facts.clear();
  }
}
