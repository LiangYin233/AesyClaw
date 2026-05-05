/**
 * MessageRepository — messages 表的数据访问层。
 *
 * 仅应持久化用户和纯文本助手消息。
 * 工具调用和工具结果由 MemoryManager 过滤掉。
 */

import type { DatabaseSync } from 'node:sqlite';
import type { PersistableMessage } from '@aesyclaw/core/types';

/** 将可持久化消息保存到会话历史 */
export async function saveMessage(
  db: DatabaseSync,
  sessionId: string,
  message: PersistableMessage,
): Promise<void> {
  const timestamp = message.timestamp ?? new Date().toISOString();

  db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run(
    sessionId,
    message.role,
    message.content,
    timestamp,
  );
}

/** 按时间顺序加载会话的所有消息 */
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

/** 获取会话最后一条消息的时间戳。无消息时返回 null。 */
export async function getLastMessageTimestamp(
  db: DatabaseSync,
  sessionId: string,
): Promise<string | null> {
  const row = db
    .prepare('SELECT timestamp FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1')
    .get(sessionId) as { timestamp: string } | undefined;
  return row?.timestamp ?? null;
}

/** 清空会话的所有消息 */
export async function clearMessageHistory(db: DatabaseSync, sessionId: string): Promise<void> {
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
}

/**
 * 将会话的消息历史替换为单条摘要消息。
 * 使用事务确保原子性。
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
