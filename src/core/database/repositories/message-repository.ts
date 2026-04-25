/**
 * MessageRepository — data access for the messages table.
 *
 * Only user and pure-text assistant messages should be persisted.
 * Tool calls and tool results are filtered out by MemoryManager.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { PersistableMessage } from '../../types';

export class MessageRepository {
  constructor(private db: DatabaseSync) {}

  /** Save a persistable message to the session history */
  async save(sessionId: string, message: PersistableMessage): Promise<void> {
    const timestamp = message.timestamp ?? new Date().toISOString();

    this.db
      .prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
      .run(sessionId, message.role, message.content, timestamp);
  }

  /** Load all messages for a session, ordered chronologically */
  async loadHistory(sessionId: string): Promise<PersistableMessage[]> {
    const rows = this.db
      .prepare('SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC, id ASC')
      .all(sessionId) as Array<{ role: string; content: string; timestamp: string }>;

    return rows.map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content,
      timestamp: row.timestamp,
    }));
  }

  /** Clear all messages for a session */
  async clearHistory(sessionId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM messages WHERE session_id = ?')
      .run(sessionId);
  }

  /**
   * Replace a session's message history with a single summary message.
   * Uses a transaction to ensure atomicity.
   */
  async replaceWithSummary(sessionId: string, summary: string): Promise<void> {
    const deleteStmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    const insertStmt = this.db
      .prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)');

    this.db.exec('BEGIN');

    try {
      deleteStmt.run(sessionId);
      insertStmt.run(sessionId, 'assistant', summary, new Date().toISOString());

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
