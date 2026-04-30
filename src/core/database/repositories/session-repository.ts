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

  db.prepare(
    'INSERT INTO sessions (id, channel, type, chat_id) VALUES (?, ?, ?, ?)',
  ).run(id, key.channel, key.type, key.chatId);

  return {
    id,
    channel: key.channel,
    type: key.type,
    chatId: key.chatId,
    createdAt: null,
    updatedAt: null,
  };
}

/** Find a session by composite key. Returns null if not found. */
export async function findSessionByKey(
  db: DatabaseSync,
  key: SessionKey,
): Promise<SessionRecord | null> {
  const row = db
    .prepare(
      `SELECT s.id, s.channel, s.type, s.chat_id,
              (SELECT m.timestamp FROM messages m WHERE m.session_id = s.id ORDER BY m.id ASC LIMIT 1) AS first_activity,
              (SELECT m.timestamp FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_activity
       FROM sessions s
       WHERE s.channel = ? AND s.type = ? AND s.chat_id = ?`,
    )
    .get(key.channel, key.type, key.chatId) as
    | { id: string; channel: string; type: string; chat_id: string; first_activity: string | null; last_activity: string | null }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    channel: row.channel,
    type: row.type,
    chatId: row.chat_id,
    createdAt: row.first_activity,
    updatedAt: row.last_activity,
  };
}

/** Get all sessions, ordered by last activity (newest first). */
export async function findAllSessions(db: DatabaseSync): Promise<SessionRecord[]> {
  const rows = db
    .prepare(
      `SELECT s.id, s.channel, s.type, s.chat_id,
              (SELECT m.timestamp FROM messages m WHERE m.session_id = s.id ORDER BY m.id ASC LIMIT 1) AS first_activity,
              (SELECT m.timestamp FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_activity
       FROM sessions s
       ORDER BY last_activity DESC, s.id DESC`,
    )
    .all() as Array<{
    id: string;
    channel: string;
    type: string;
    chat_id: string;
    first_activity: string | null;
    last_activity: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    type: row.type,
    chatId: row.chat_id,
    createdAt: row.first_activity,
    updatedAt: row.last_activity,
  }));
}

/** Find a session by ID. Returns null if not found. */
export async function findSessionById(db: DatabaseSync, id: string): Promise<SessionRecord | null> {
  const row = db
    .prepare(
      `SELECT s.id, s.channel, s.type, s.chat_id,
              (SELECT m.timestamp FROM messages m WHERE m.session_id = s.id ORDER BY m.id ASC LIMIT 1) AS first_activity,
              (SELECT m.timestamp FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_activity
       FROM sessions s
       WHERE s.id = ?`,
    )
    .get(id) as
    | { id: string; channel: string; type: string; chat_id: string; first_activity: string | null; last_activity: string | null }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    channel: row.channel,
    type: row.type,
    chatId: row.chat_id,
    createdAt: row.first_activity,
    updatedAt: row.last_activity,
  };
}
