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
      'SELECT id, channel, type, chat_id, role_id, model_id FROM sessions WHERE channel = ? AND type = ? AND chat_id = ?',
    )
    .get(key.channel, key.type, key.chatId) as SessionRow | undefined;

  return row ? toSessionRecord(row) : null;
}

/** 获取所有会话。 */
export async function findAllSessions(db: DatabaseSync): Promise<SessionRecord[]> {
  const rows = db
    .prepare('SELECT id, channel, type, chat_id, role_id, model_id FROM sessions ORDER BY id')
    .all() as SessionRow[];

  return rows.map((row) => toSessionRecord(row));
}

/** 按 ID 查找会话。未找到时返回 null。 */
export async function findSessionById(db: DatabaseSync, id: string): Promise<SessionRecord | null> {
  const row = db
    .prepare('SELECT id, channel, type, chat_id, role_id, model_id FROM sessions WHERE id = ?')
    .get(id) as SessionRow | undefined;

  return row ? toSessionRecord(row) : null;
}

/** 按 ID 删除会话及其直接关联数据。返回是否删除了会话。 */
export async function deleteSessionById(db: DatabaseSync, id: string): Promise<boolean> {
  const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id) as { id: string } | undefined;

  if (!row) return false;

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE usage SET session_id = NULL WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** 设置会话的角色 */
export async function setSessionRole(db: DatabaseSync, id: string, roleId: string): Promise<void> {
  db.prepare('UPDATE sessions SET role_id = ? WHERE id = ?').run(roleId, id);
}

/** 设置会话的模型 */
export async function setSessionModel(
  db: DatabaseSync,
  id: string,
  modelId: string,
): Promise<void> {
  db.prepare('UPDATE sessions SET model_id = ? WHERE id = ?').run(modelId, id);
}

type SessionRow = {
  id: string;
  channel: string;
  type: string;
  chat_id: string;
  role_id: string | null;
  model_id: string | null;
};

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    channel: row.channel,
    type: row.type,
    chatId: row.chat_id,
    role_id: row.role_id ?? undefined,
    model_id: row.model_id ?? undefined,
  };
}
