import { randomUUID } from 'crypto';
import type { MessageRole, StandardMessage } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import { sqliteManager } from '../sqlite-manager.js';

export interface SessionMessageRow {
  id: string;
  session_id: string;
  sequence: number;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  name: string | null;
  created_at: string;
}

export interface PersistedSessionMessage {
  id: string;
  sessionId: string;
  sequence: number;
  role: MessageRole;
  content: string;
  toolCalls?: StandardMessage['toolCalls'];
  toolCallId?: string;
  name?: string;
  createdAt: string;
}

export interface ReplaceSessionMessagesInput {
  role: MessageRole;
  content: string;
  toolCalls?: StandardMessage['toolCalls'];
  toolCallId?: string;
  name?: string;
}

export class SessionMessageRepository {
  findBySessionId(sessionId: string): PersistedSessionMessage[] {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM session_messages
      WHERE session_id = ?
      ORDER BY sequence ASC
    `);
    const rows = stmt.all(sessionId) as SessionMessageRow[];

    return rows.map(row => this.mapRow(row));
  }

  replaceForSession(sessionId: string, messages: ReplaceSessionMessagesInput[]): void {
    sqliteManager.transaction(() => {
      const db = sqliteManager.getDatabase();
      db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(sessionId);

      if (messages.length === 0) {
        return;
      }

      const stmt = db.prepare(`
        INSERT INTO session_messages (
          id, session_id, sequence, role, content, tool_calls, tool_call_id, name
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const [index, message] of messages.entries()) {
        stmt.run(
          randomUUID(),
          sessionId,
          index,
          message.role,
          message.content,
          message.toolCalls ? JSON.stringify(message.toolCalls) : null,
          message.toolCallId || null,
          message.name || null
        );
      }
    });

    logger.debug({ sessionId, count: messages.length }, 'Session messages replaced');
  }

  deleteBySessionId(sessionId: string): number {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('DELETE FROM session_messages WHERE session_id = ?');
    const result = stmt.run(sessionId);

    if (result.changes > 0) {
      logger.info({ sessionId, count: result.changes }, 'Session messages deleted');
    }

    return result.changes;
  }

  private mapRow(row: SessionMessageRow): PersistedSessionMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      sequence: row.sequence,
      role: row.role as MessageRole,
      content: row.content,
      toolCalls: row.tool_calls ? (JSON.parse(row.tool_calls) as StandardMessage['toolCalls']) : undefined,
      toolCallId: row.tool_call_id || undefined,
      name: row.name || undefined,
      createdAt: row.created_at,
    };
  }
}

export const sessionMessageRepository = new SessionMessageRepository();
