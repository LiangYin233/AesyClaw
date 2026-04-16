import { sqliteManager } from '../sqlite-manager.js';
import { logger } from '../../../platform/observability/logger.js';

export interface SessionRecord {
  sessionId: string;
  chatId: string;
  channel: string;
  type: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface CreateSessionInput {
  sessionId: string;
  chatId: string;
  channel: string;
  type: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export type SessionRow = {
  session_id: string;
  chat_id: string;
  channel: string;
  type: string;
  user_id?: string;
  created_at: string;
  updated_at: string;
  metadata: string;
};

export class SessionRepository {
  create(input: CreateSessionInput): SessionRecord {
    const db = sqliteManager.getDatabase();
    const metadata = JSON.stringify(input.metadata || {});

    const stmt = db.prepare(`
      INSERT INTO sessions (session_id, chat_id, channel, type, user_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(input.sessionId, input.chatId, input.channel, input.type, input.userId || null, metadata);
    logger.info({ sessionId: input.sessionId, chatId: input.chatId }, 'Session created');

    return this.findBySessionId(input.sessionId)!;
  }

  findBySessionId(sessionId: string): SessionRecord | null {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions WHERE session_id = ?');
    const row = stmt.get(sessionId) as SessionRow;

    if (!row) return null;

    return this.mapRowToRecord(row);
  }

  findByChatId(chatId: string): SessionRecord[] {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions WHERE chat_id = ? ORDER BY created_at DESC');
    const rows = stmt.all(chatId) as SessionRow[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  update(
    sessionId: string,
    updates: Partial<Omit<CreateSessionInput, 'sessionId'>>
  ): SessionRecord | null {
    const db = sqliteManager.getDatabase();
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: Array<string | null> = [];

    if (updates.chatId !== undefined) {
      fields.push('chat_id = ?');
      values.push(updates.chatId);
    }
    if (updates.channel !== undefined) {
      fields.push('channel = ?');
      values.push(updates.channel);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.userId !== undefined) {
      fields.push('user_id = ?');
      values.push(updates.userId);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    values.push(sessionId);

    const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE session_id = ?`);
    const result = stmt.run(...values);

    if (result.changes === 0) return null;

    logger.info({ sessionId }, 'Session updated');
    return this.findBySessionId(sessionId);
  }

  delete(sessionId: string): boolean {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('DELETE FROM sessions WHERE session_id = ?');
    const result = stmt.run(sessionId);

    if (result.changes > 0) {
      logger.info({ sessionId }, 'Session deleted');
      return true;
    }
    return false;
  }

  findAll(): SessionRecord[] {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC');
    const rows = stmt.all() as SessionRow[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  findByScope(channel: string, type?: string, chatId?: string): SessionRecord[] {
    const db = sqliteManager.getDatabase();
    let query = 'SELECT * FROM sessions WHERE channel = ?';
    const params: Array<string> = [channel];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (chatId) {
      query += ' AND chat_id = ?';
      params.push(chatId);
    }

    query += ' ORDER BY created_at DESC';
    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as SessionRow[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  upsert(input: CreateSessionInput): SessionRecord {
    const existing = this.findBySessionId(input.sessionId);
    if (existing) {
      return this.update(input.sessionId, input) || existing;
    }
    return this.create(input);
  }

  ensure(input: CreateSessionInput): SessionRecord {
    return this.upsert(input);
  }

  private mapRowToRecord(row: SessionRow): SessionRecord {
    return {
      sessionId: row.session_id,
      chatId: row.chat_id,
      channel: row.channel,
      type: row.type,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
}

export const sessionRepository = new SessionRepository();
