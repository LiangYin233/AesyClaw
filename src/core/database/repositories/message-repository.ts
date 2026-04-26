/**
 * MessageRepository — data access for the messages table.
 *
 * Only user and pure-text assistant messages should be persisted.
 * Tool calls and tool results are filtered out by MemoryManager.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { PersistableMessage } from '../../types';

/** Save a persistable message to the session history */
export async function saveMessage(
  db: DatabaseSync,
  sessionId: string,
  message: PersistableMessage,
): Promise<void> {
  const timestamp = message.timestamp ?? new Date().toISOString();

  db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
    .run(sessionId, message.role, message.content, timestamp);
}

/** Load all messages for a session, ordered chronologically */
export async function loadMessageHistory(
  db: DatabaseSync,
  sessionId: string,
): Promise<PersistableMessage[]> {
  const rows = db
    .prepare(
      'SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC, id ASC',
    )
    .all(sessionId) as Array<{ role: string; content: string; timestamp: string }>;

  return rows.map((row) => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
    timestamp: row.timestamp,
  }));
}

/** Clear all messages for a session */
export async function clearMessageHistory(db: DatabaseSync, sessionId: string): Promise<void> {
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
}

/**
 * Replace a session's message history with a single summary message.
 * Uses a transaction to ensure atomicity.
 */
export async function replaceMessageWithSummary(
  db: DatabaseSync,
  sessionId: string,
  summary: string,
): Promise<void> {
  const deleteStmt = db.prepare('DELETE FROM messages WHERE session_id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
  );

  db.exec('BEGIN');

  try {
    deleteStmt.run(sessionId);
    insertStmt.run(sessionId, 'assistant', summary, new Date().toISOString());

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
