/**
 * SessionRepository — data access for the sessions table.
 *
 * All methods return Promises (wrapping synchronous SQLite calls)
 * for future flexibility and consistent async patterns.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SessionKey, SessionRecord } from '../../types';

export class SessionRepository {
  constructor(private db: DatabaseSync) {}

  /**
   * Find an existing session by its composite key, or create one if not found.
   * Uses the UNIQUE(channel, type, chat_id) constraint for idempotency.
   */
  async findOrCreate(key: SessionKey): Promise<SessionRecord> {
    // Try to find existing
    const existing = await this.findByKey(key);
    if (existing) {
      return existing;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        'INSERT INTO sessions (id, channel, type, chat_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, key.channel, key.type, key.chatId, now);

    return {
      id,
      channel: key.channel,
      type: key.type,
      chatId: key.chatId,
      createdAt: now,
    };
  }

  /** Find a session by composite key. Returns null if not found. */
  async findByKey(key: SessionKey): Promise<SessionRecord | null> {
    const row = this.db
      .prepare(
        'SELECT id, channel, type, chat_id, created_at FROM sessions WHERE channel = ? AND type = ? AND chat_id = ?',
      )
      .get(key.channel, key.type, key.chatId) as
      | { id: string; channel: string; type: string; chat_id: string; created_at: string }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      channel: row.channel,
      type: row.type,
      chatId: row.chat_id,
      createdAt: row.created_at,
    };
  }
}
