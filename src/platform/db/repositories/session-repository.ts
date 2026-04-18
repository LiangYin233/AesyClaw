import { logger } from '@/platform/observability/logger.js';
import { BaseRepository } from './base-repository.js';

export interface SessionRecord {
  id: string;
  chatId: string;
  channel: string;
  type: string;
  roleId: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  id: string;
  chatId: string;
  channel: string;
  type: string;
  roleId: string;
}

export type SessionRow = {
  id: string;
  chat_id: string;
  channel: string;
  type: string;
  role_id: string;
  message_count: number;
  created_at: string;
  updated_at: string;
};

const ORDER = 'ORDER BY updated_at DESC, created_at DESC';

export class SessionRepository extends BaseRepository<SessionRow, SessionRecord> {
  create(input: CreateSessionInput): SessionRecord {
    this.db.prepare(`
      INSERT INTO sessions (id, chat_id, channel, type, role_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.id, input.chatId, input.channel, input.type, input.roleId);

    logger.info({ sessionId: input.id, chatId: input.chatId }, 'Session created');
    return this.findById(input.id)!;
  }

  findById(sessionId: string): SessionRecord | null {
    return this.queryOne('SELECT * FROM sessions WHERE id = ?', sessionId);
  }

  findLatestByChatId(chatId: string): SessionRecord | null {
    return this.queryOne(
      `SELECT * FROM sessions WHERE chat_id = ? ${ORDER} LIMIT 1`,
      chatId
    );
  }

  findByChatId(chatId: string): SessionRecord[] {
    return this.queryMany(`SELECT * FROM sessions WHERE chat_id = ? ${ORDER}`, chatId);
  }

  updateState(
    sessionId: string,
    updates: Partial<Pick<SessionRecord, 'roleId' | 'messageCount'>>
  ): SessionRecord | null {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: Array<string | number> = [];

    if (updates.roleId !== undefined) {
      fields.push('role_id = ?');
      values.push(updates.roleId);
    }
    if (updates.messageCount !== undefined) {
      fields.push('message_count = ?');
      values.push(updates.messageCount);
    }

    values.push(sessionId);

    const result = this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (result.changes === 0) return null;

    logger.info({ sessionId }, 'Session updated');
    return this.findById(sessionId);
  }

  delete(sessionId: string): boolean {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

    if (result.changes > 0) {
      logger.info({ sessionId }, 'Session deleted');
      return true;
    }
    return false;
  }

  findAll(): SessionRecord[] {
    return this.queryMany(`SELECT * FROM sessions ${ORDER}`);
  }

  protected mapRow(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      chatId: row.chat_id,
      channel: row.channel,
      type: row.type,
      roleId: row.role_id,
      messageCount: row.message_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const sessionRepository = new SessionRepository();
