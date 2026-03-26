import type { Database, DBConversationMemory, DBMessage, DBSession, DBSessionMemory } from '../../../platform/db/index.js';

export class SessionStore {
  constructor(private readonly db: Database) {}

  async ready(): Promise<void> {
    await this.db.ready();
  }

  async insertSession(key: string, channel: string, chatId: string, uuid: string | null, createdAt: string): Promise<number | undefined> {
    const result = await this.db.run(
      `INSERT INTO sessions (key, channel, chat_id, uuid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [key, channel, chatId, uuid, createdAt, createdAt]
    );
    return result.lastID;
  }

  async loadSession(key: string): Promise<DBSession | null> {
    const rows = await this.db.all<DBSession>(`SELECT * FROM sessions WHERE key = ?`, [key]);
    return rows.length > 0 ? rows[0] : null;
  }

  async loadSessionData(row: DBSession): Promise<{ messages: DBMessage[]; memory: DBSessionMemory | undefined }> {
    const [messages, memory] = await Promise.all([
      this.db.all<DBMessage>(`SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC`, [row.id]),
      this.db.get<DBSessionMemory>(`SELECT * FROM session_memory WHERE session_id = ?`, [row.id])
    ]);
    return { messages, memory };
  }

  async loadAllSessions(limit: number): Promise<DBSession[]> {
    return this.db.all<DBSession>(
      `SELECT * FROM sessions ORDER BY datetime(updated_at) DESC LIMIT ?`,
      [limit]
    );
  }

  async addMessage(sessionId: number, role: string, content: string, timestamp: string, key: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
        [sessionId, role, content, timestamp]
      );
      await this.db.run(`UPDATE sessions SET updated_at = ? WHERE key = ?`, [timestamp, key]);
    });
  }

  async upsertSummary(sessionId: number, summary: string, summarizedMessageCount: number, updatedAt: string, key: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO session_memory (session_id, summary, summarized_message_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           summary = excluded.summary,
           summarized_message_count = excluded.summarized_message_count,
           updated_at = excluded.updated_at`,
        [sessionId, summary, summarizedMessageCount, updatedAt]
      );
      await this.db.run(
        `UPDATE sessions SET updated_at = ? WHERE key = ?`,
        [updatedAt, key]
      );
    });
  }

  async getConversationMessages(channel: string, chatId: string): Promise<{
    id: number;
    session_id: number;
    session_key: string;
    role: string;
    content: string;
    timestamp: string;
  }[]> {
    return this.db.all(
      `SELECT
         m.id,
         m.session_id,
         s.key as session_key,
         m.role,
         m.content,
         m.timestamp
       FROM messages m
       INNER JOIN sessions s ON s.id = m.session_id
       WHERE s.channel = ? AND s.chat_id = ?
       ORDER BY m.id ASC`,
      [channel, chatId]
    );
  }

  async getConversationMemory(channel: string, chatId: string): Promise<DBConversationMemory | undefined> {
    return this.db.get<DBConversationMemory>(
      `SELECT * FROM conversation_memory WHERE channel = ? AND chat_id = ?`,
      [channel, chatId]
    );
  }

  async updateConversationSummary(channel: string, chatId: string, summary: string, summarizedUntilMessageId: number, updatedAt: string): Promise<void> {
    await this.db.run(
      `INSERT INTO conversation_memory (channel, chat_id, summary, summarized_until_message_id, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel, chat_id) DO UPDATE SET
         summary = excluded.summary,
         summarized_until_message_id = excluded.summarized_until_message_id,
         updated_at = excluded.updated_at`,
      [channel, chatId, summary, summarizedUntilMessageId, updatedAt]
    );
  }

  async deleteSummary(sessionId: number): Promise<void> {
    await this.db.run(`DELETE FROM session_memory WHERE session_id = ?`, [sessionId]);
  }

  async deleteAllSummaries(): Promise<void> {
    await this.db.run(`DELETE FROM session_memory`);
    await this.db.run(`DELETE FROM conversation_memory`);
  }

  async deleteSummariesForConversation(channel: string, chatId: string): Promise<void> {
    await this.db.run(
      `DELETE FROM session_memory
       WHERE session_id IN (
         SELECT id FROM sessions WHERE channel = ? AND chat_id = ?
       )`,
      [channel, chatId]
    );
    await this.db.run(`DELETE FROM conversation_memory WHERE channel = ? AND chat_id = ?`, [channel, chatId]);
  }

  async deleteSession(key: string): Promise<void> {
    await this.db.run(`DELETE FROM sessions WHERE key = ?`, [key]);
  }

  async countSessions(): Promise<number> {
    const result = await this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM sessions');
    return result?.count ?? 0;
  }

  async findOldestSessions(limit: number): Promise<DBSession[]> {
    return this.db.all<DBSession>(
      `SELECT key FROM sessions ORDER BY datetime(updated_at) ASC LIMIT ?`,
      [limit]
    );
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
