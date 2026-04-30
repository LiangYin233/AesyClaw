/**
 * SessionRepository — sessions 表的数据访问层。
 *
 * 所有方法均返回 Promise（包装同步 SQLite 调用）
 * 以便未来灵活扩展和保持一致的异步模式。
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SessionKey, SessionRecord } from '../../types';

/** 按复合键查找现有会话，如不存在则创建。 */
export async function findOrCreateSession(
  db: DatabaseSync,
  key: SessionKey,
): Promise<SessionRecord> {
  const id = randomUUID();

  db.prepare(
    'INSERT OR IGNORE INTO sessions (id, channel, type, chat_id) VALUES (?, ?, ?, ?)',
  ).run(id, key.channel, key.type, key.chatId);

  const session = await findSessionByKey(db, key);
  if (!session) {
    throw new Error('查找或创建会话失败');
  }

  return session;
}

/** 按复合键查找会话。未找到时返回 null。 */
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

/** 获取所有会话，按最后活动时间排序（最新的在前）。 */
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

/** 按 ID 查找会话。未找到时返回 null。 */
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
