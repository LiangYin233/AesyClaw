import { logger } from '@/platform/observability/logger.js';
import { sqliteManager } from '../sqlite-manager.js';

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

export interface SessionScope {
  channel: string;
  type: string;
  chatId: string;
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

export class SessionRepository {
  create(input: CreateSessionInput): SessionRecord {
    const db = sqliteManager.getDatabase();

    const stmt = db.prepare(`
      INSERT INTO sessions_v2 (id, chat_id, channel, type, role_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(input.id, input.chatId, input.channel, input.type, input.roleId);
    logger.info({ sessionId: input.id, chatId: input.chatId }, 'Session created');

    return this.findById(input.id)!;
  }

  findById(sessionId: string): SessionRecord | null {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions_v2 WHERE id = ?');
    const row = stmt.get(sessionId) as SessionRow | undefined;

    if (!row) return null;

    return this.mapRowToRecord(row);
  }

  findLatestByScope(scope: SessionScope): SessionRecord | null {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM sessions_v2
      WHERE channel = ? AND type = ? AND chat_id = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(scope.channel, scope.type, scope.chatId) as SessionRow | undefined;

    if (!row) return null;

    return this.mapRowToRecord(row);
  }

  findByChatId(chatId: string): SessionRecord[] {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions_v2 WHERE chat_id = ? ORDER BY updated_at DESC, created_at DESC');
    const rows = stmt.all(chatId) as SessionRow[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  updateState(
    sessionId: string,
    updates: Partial<Pick<SessionRecord, 'roleId' | 'messageCount'>>
  ): SessionRecord | null {
    const db = sqliteManager.getDatabase();
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

    const stmt = db.prepare(`UPDATE sessions_v2 SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);

    if (result.changes === 0) return null;

    logger.info({ sessionId }, 'Session updated');
    return this.findById(sessionId);
  }

  delete(sessionId: string): boolean {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('DELETE FROM sessions_v2 WHERE id = ?');
    const result = stmt.run(sessionId);

    if (result.changes > 0) {
      logger.info({ sessionId }, 'Session deleted');
      return true;
    }
    return false;
  }

  findAll(): SessionRecord[] {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions_v2 ORDER BY updated_at DESC, created_at DESC');
    const rows = stmt.all() as SessionRow[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  findByScope(channel: string, type?: string, chatId?: string): SessionRecord[] {
    const db = sqliteManager.getDatabase();
    let query = 'SELECT * FROM sessions_v2 WHERE channel = ?';
    const params: Array<string> = [channel];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (chatId) {
      query += ' AND chat_id = ?';
      params.push(chatId);
    }

    query += ' ORDER BY updated_at DESC, created_at DESC';
    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as SessionRow[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  private mapRowToRecord(row: SessionRow): SessionRecord {
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
