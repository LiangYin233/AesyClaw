import { type Database, type DBMemoryFact } from '../db/index.js';

export interface MemoryFact {
  content: string;
  updatedAt?: string;
}

export class MemoryFactStore {
  private facts: Map<string, MemoryFact[]> = new Map();

  constructor(private db: Database) {}

  private createConversationKey(channel: string, chatId: string): string {
    return `${channel}:${chatId}`;
  }

  async getFacts(channel: string, chatId: string): Promise<MemoryFact[]> {
    const conversationKey = this.createConversationKey(channel, chatId);
    const cached = this.facts.get(conversationKey);
    if (cached) {
      return cached;
    }

    const rows = await this.db.all<DBMemoryFact>(
      `SELECT * FROM memory_facts WHERE channel = ? AND chat_id = ? ORDER BY updated_at DESC, id DESC`,
      [channel, chatId]
    );

    const facts = rows.map((row) => ({ content: row.fact, updatedAt: row.updated_at }));
    this.facts.set(conversationKey, facts);
    return facts;
  }

  async setFacts(channel: string, chatId: string, facts: string[]): Promise<void> {
    const conversationKey = this.createConversationKey(channel, chatId);
    const normalizedFacts = Array.from(new Set(
      facts.map((fact) => fact.trim()).filter(Boolean)
    ));
    const updatedAt = new Date().toISOString();

    await this.db.transaction(async () => {
      await this.db.run(
        `DELETE FROM memory_facts WHERE channel = ? AND chat_id = ?`,
        [channel, chatId]
      );

      for (const fact of normalizedFacts) {
        await this.db.run(
          `INSERT INTO memory_facts (channel, chat_id, fact, updated_at) VALUES (?, ?, ?, ?)`,
          [channel, chatId, fact, updatedAt]
        );
      }
    });

    this.facts.set(
      conversationKey,
      normalizedFacts.map((content) => ({ content, updatedAt }))
    );
  }
}
