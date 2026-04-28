/**
 * SessionRepository — data access for the sessions table.
 *
 * All methods return Promises (wrapping synchronous SQLite calls)
 * for future flexibility and consistent async patterns.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SessionKey, SessionRecord } from '../../types';

/** Find an existing session by its composite key, or create one if not found. */
export async function findOrCreateSession(
  db: DatabaseSync,
  key: SessionKey,
): Promise<SessionRecord> {
  const existing = await findSessionByKey(db, key);
  if (existing) {
    return existing;
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO sessions (id, channel, type, chat_id, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, key.channel, key.type, key.chatId, now);

  return {
    id,
    channel: key.channel,
    type: key.type,
    chatId: key.chatId,
    createdAt: now,
  };
}

/** Find a session by composite key. Returns null if not found. */
export async function findSessionByKey(
  db: DatabaseSync,
  key: SessionKey,
): Promise<SessionRecord | null> {
  const row = db
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

/** Get all sessions, ordered by creation time (newest first). */
export async function findAllSessions(db: DatabaseSync): Promise<SessionRecord[]> {
  const rows = db
    .prepare('SELECT id, channel, type, chat_id, created_at FROM sessions ORDER BY created_at DESC')
    .all() as Array<{
    id: string;
    channel: string;
    type: string;
    chat_id: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    type: row.type,
    chatId: row.chat_id,
    createdAt: row.created_at,
  }));
}

/** Find a session by ID. Returns null if not found. */
export async function findSessionById(db: DatabaseSync, id: string): Promise<SessionRecord | null> {
  const row = db
    .prepare('SELECT id, channel, type, chat_id, created_at FROM sessions WHERE id = ?')
    .get(id) as
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
