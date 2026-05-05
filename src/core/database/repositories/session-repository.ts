/**
 * SessionRepository — sessions 表的数据访问层。
 *
 * 所有方法均返回 Promise（包装同步 SQLite 调用）
 * 以便未来灵活扩展和保持一致的异步模式。
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SessionKey, SessionRecord } from '@aesyclaw/core/types';

/** 按复合键查找现有会话，如不存在则创建。 */
export async function findOrCreateSession(
  db: DatabaseSync,
  key: SessionKey,
): Promise<SessionRecord> {
  const id = randomUUID();

  db.prepare('INSERT OR IGNORE INTO sessions (id, channel, type, chat_id) VALUES (?, ?, ?, ?)').run(
    id,
    key.channel,
    key.type,
    key.chatId,
  );

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
      'SELECT id, channel, type, chat_id FROM sessions WHERE channel = ? AND type = ? AND chat_id = ?',
    )
    .get(key.channel, key.type, key.chatId) as
    | { id: string; channel: string; type: string; chat_id: string }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    channel: row.channel,
    type: row.type,
    chatId: row.chat_id,
  };
}

/** 获取所有会话及最后活动时间，按最后活动排序。 */
export async function findAllSessions(db: DatabaseSync): Promise<SessionRecord[]> {
  const rows = db
    .prepare(
      `SELECT s.id, s.channel, s.type, s.chat_id, MAX(m.timestamp) AS last_activity
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.id
       GROUP BY s.id
       ORDER BY last_activity DESC`,
    )
    .all() as Array<{
    id: string;
    channel: string;
    type: string;
    chat_id: string;
    last_activity: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    type: row.type,
    chatId: row.chat_id,
    ...(row.last_activity ? { lastActivity: row.last_activity } : {}),
  }));
}

/** 按 ID 查找会话。未找到时返回 null。 */
export async function findSessionById(db: DatabaseSync, id: string): Promise<SessionRecord | null> {
  const row = db.prepare('SELECT id, channel, type, chat_id FROM sessions WHERE id = ?').get(id) as
    | { id: string; channel: string; type: string; chat_id: string }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    channel: row.channel,
    type: row.type,
    chatId: row.chat_id,
  };
}
