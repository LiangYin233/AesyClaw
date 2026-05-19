/**
 * MessageRepository — messages 表的数据访问层。
 *
 * 仅应持久化用户和纯文本助手消息。
 * 工具调用和工具结果在会话同步为可持久化消息时过滤掉。
 */

import type { DatabaseSync } from 'node:sqlite';
import type { MessageUsage, PersistableMessage } from '@aesyclaw/core/types';

/** 将可持久化消息保存到会话历史，返回生成的消息 ID。 */
export async function saveMessage(
  db: DatabaseSync,
  sessionId: string,
  message: PersistableMessage,
): Promise<number> {
  const timestamp = message.timestamp ?? new Date().toISOString();
  const result = db
    .prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
    .run(sessionId, message.role, message.content, timestamp);

  return Number(result.lastInsertRowid);
}

/** 按时间顺序加载会话的所有消息。消息级用量从 usage 表关联读取。 */
export async function loadMessageHistory(
  db: DatabaseSync,
  sessionId: string,
): Promise<PersistableMessage[]> {
  const rows = db
    .prepare(
      `SELECT
        m.role,
        m.content,
        m.timestamp,
        u.id AS usage_id,
        u.input_tokens,
        u.output_tokens,
        u.total_tokens,
        u.cache_read_tokens,
        u.cache_write_tokens,
        u.cost_input,
        u.cost_output,
        u.cost_cache_read,
        u.cost_cache_write,
        u.cost_total
      FROM messages m
      LEFT JOIN usage u ON u.message_id = m.id
      WHERE m.session_id = ?
      ORDER BY m.timestamp ASC, m.id ASC`,
    )
    .all(sessionId) as MessageHistoryRow[];

  return rows.map((row) => {
    const usage = row.role === 'assistant' && row.usage_id !== null ? usageFromRow(row) : undefined;
    return {
      role: row.role as 'user' | 'assistant',
      content: row.content,
      timestamp: row.timestamp,
      ...(usage ? { usage } : {}),
    };
  });
}

/** 清空会话的所有消息 */
export async function clearMessageHistory(db: DatabaseSync, sessionId: string): Promise<void> {
  db.prepare('UPDATE usage SET message_id = NULL WHERE session_id = ?').run(sessionId);
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
  const unlinkUsageStmt = db.prepare('UPDATE usage SET message_id = NULL WHERE session_id = ?');
  const deleteStmt = db.prepare('DELETE FROM messages WHERE session_id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
  );

  db.exec('BEGIN');

  try {
    unlinkUsageStmt.run(sessionId);
    deleteStmt.run(sessionId);
    insertStmt.run(sessionId, 'assistant', summary, new Date().toISOString());

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

type MessageHistoryRow = {
  role: string;
  content: string;
  timestamp: string;
  usage_id: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_input: number | null;
  cost_output: number | null;
  cost_cache_read: number | null;
  cost_cache_write: number | null;
  cost_total: number | null;
};

function usageFromRow(row: MessageHistoryRow): MessageUsage | undefined {
  if (
    row.input_tokens === null ||
    row.output_tokens === null ||
    row.total_tokens === null ||
    row.cache_read_tokens === null ||
    row.cache_write_tokens === null
  ) {
    return undefined;
  }

  return {
    input: row.input_tokens,
    output: row.output_tokens,
    cacheRead: row.cache_read_tokens,
    cacheWrite: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    cost: {
      input: row.cost_input ?? 0,
      output: row.cost_output ?? 0,
      cacheRead: row.cost_cache_read ?? 0,
      cacheWrite: row.cost_cache_write ?? 0,
      total: row.cost_total ?? 0,
    },
  };
}
