/**
 * MessageRepository — messages 表的数据访问层。
 *
 * 仅应持久化用户和纯文本助手消息。
 * 工具调用和工具结果在会话同步为可持久化消息时过滤掉。
 */

import type { DatabaseSync } from 'node:sqlite';
import type { MessageUsage, PersistableMessage } from '@aesyclaw/core/types';

/** 将可持久化消息保存到会话历史 */
export async function saveMessage(
  db: DatabaseSync,
  sessionId: string,
  message: PersistableMessage,
): Promise<void> {
  const timestamp = message.timestamp ?? new Date().toISOString();
  const usageJson = message.usage ? JSON.stringify(message.usage) : null;

  if (hasMessageUsageColumn(db)) {
    db.prepare(
      'INSERT INTO messages (session_id, role, content, timestamp, usage_json) VALUES (?, ?, ?, ?, ?)',
    ).run(sessionId, message.role, message.content, timestamp, usageJson);
    return;
  }

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
  const hasUsageJson = hasMessageUsageColumn(db);
  const rows = db
    .prepare(
      `SELECT role, content, timestamp${hasUsageJson ? ', usage_json' : ''} FROM messages WHERE session_id = ? ORDER BY timestamp ASC, id ASC`,
    )
    .all(sessionId) as Array<{
    role: string;
    content: string;
    timestamp: string;
    usage_json?: string | null;
  }>;

  return rows.map((row) => {
    const usage = row.usage_json ? parseUsageJson(row.usage_json) : undefined;
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
  const hasUsageJson = hasMessageUsageColumn(db);
  const insertStmt = db.prepare(
    hasUsageJson
      ? 'INSERT INTO messages (session_id, role, content, timestamp, usage_json) VALUES (?, ?, ?, ?, ?)'
      : 'INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
  );

  db.exec('BEGIN');

  try {
    deleteStmt.run(sessionId);
    if (hasUsageJson) {
      insertStmt.run(sessionId, 'assistant', summary, new Date().toISOString(), null);
    } else {
      insertStmt.run(sessionId, 'assistant', summary, new Date().toISOString());
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function hasMessageUsageColumn(db: DatabaseSync): boolean {
  const rows = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
  return rows.some((row) => row.name === 'usage_json');
}

function parseUsageJson(value: string): MessageUsage | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isUsage(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isUsage(value: unknown): value is MessageUsage {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value['input']) &&
    isFiniteNumber(value['output']) &&
    isFiniteNumber(value['cacheRead']) &&
    isFiniteNumber(value['cacheWrite']) &&
    isFiniteNumber(value['totalTokens']) &&
    (value['cost'] === undefined || isUsageCost(value['cost']))
  );
}

function isUsageCost(value: unknown): value is NonNullable<MessageUsage['cost']> {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value['input']) &&
    isFiniteNumber(value['output']) &&
    isFiniteNumber(value['cacheRead']) &&
    isFiniteNumber(value['cacheWrite']) &&
    isFiniteNumber(value['total'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
