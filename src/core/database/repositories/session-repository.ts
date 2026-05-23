/**
 * SessionRepository — sessions 表的数据访问层。
 *
 * 所有方法均返回 Promise（包装同步 SQLite 调用）
 * 以便未来灵活扩展和保持一致的异步模式。
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SessionKey, SessionRecord } from '@aesyclaw/core/types';

export type SessionSummaryRecord = SessionRecord & {
  firstUserMessage?: string;
  messageCount: number;
};

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

/** 获取所有会话摘要，包含首条用户消息和消息数量，避免按会话逐个加载完整历史。 */
export async function findAllSessionSummaries(db: DatabaseSync): Promise<SessionSummaryRecord[]> {
  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.channel,
         s.type,
         s.chat_id,
         MAX(m.timestamp) AS last_activity,
         COUNT(m.id) AS message_count,
         (
           SELECT m2.content
           FROM messages m2
           WHERE m2.session_id = s.id AND m2.role = 'user'
           ORDER BY m2.timestamp ASC, m2.id ASC
           LIMIT 1
         ) AS first_user_message
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
    message_count: number;
    first_user_message: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    type: row.type,
    chatId: row.chat_id,
    messageCount: row.message_count,
    ...(row.last_activity ? { lastActivity: row.last_activity } : {}),
    ...(row.first_user_message ? { firstUserMessage: row.first_user_message } : {}),
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

/** 按复合键删除会话及其直接关联数据。返回是否删除了会话。 */
export async function deleteSessionByKey(db: DatabaseSync, key: SessionKey): Promise<boolean> {
  const row = db
    .prepare('SELECT id FROM sessions WHERE channel = ? AND type = ? AND chat_id = ?')
    .get(key.channel, key.type, key.chatId) as { id: string } | undefined;

  if (!row) return false;

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE usage SET message_id = NULL WHERE session_id = ?').run(row.id);
    db.prepare('UPDATE usage SET session_id = NULL WHERE session_id = ?').run(row.id);
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(row.id);
    db.prepare('DELETE FROM role_bindings WHERE session_id = ?').run(row.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
