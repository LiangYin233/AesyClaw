import { sqliteManager } from '../sqlite-manager.js';
import { logger } from '../../../platform/observability/logger.js';

export interface SessionRecord {
  chatId: string;
  channelType: string;
  channelId?: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface CreateSessionInput {
  chatId: string;
  channelType: string;
  channelId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export type SessionRow = {
  chat_id: string;
  channel_type: string;
  channel_id?: string;
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
      INSERT INTO sessions (chat_id, channel_type, channel_id, user_id, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(input.chatId, input.channelType, input.channelId || null, input.userId || null, metadata);
    logger.info({ chatId: input.chatId }, 'Session created');

    return this.findByChatId(input.chatId)!;
  }

  findByChatId(chatId: string): SessionRecord | null {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions WHERE chat_id = ?');
    const row = stmt.get(chatId) as SessionRow;

    if (!row) return null;

    return this.mapRowToRecord(row);
  }

  update(chatId: string, updates: Partial<Omit<CreateSessionInput, 'chatId'>>): SessionRecord | null {
    const db = sqliteManager.getDatabase();
    const fields: string[] = ['updated_at = datetime("now")'];
    const values: Array<string | null> = [];

    if (updates.channelType !== undefined) {
      fields.push('channel_type = ?');
      values.push(updates.channelType);
    }
    if (updates.channelId !== undefined) {
      fields.push('channel_id = ?');
      values.push(updates.channelId);
    }
    if (updates.userId !== undefined) {
      fields.push('user_id = ?');
      values.push(updates.userId);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    values.push(chatId);

    const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE chat_id = ?`);
    const result = stmt.run(...values);

    if (result.changes === 0) return null;

    logger.info({ chatId }, 'Session updated');
    return this.findByChatId(chatId);
  }

  delete(chatId: string): boolean {
    const db = sqliteManager.getDatabase();
    const stmt = db.prepare('DELETE FROM sessions WHERE chat_id = ?');
    const result = stmt.run(chatId);

    if (result.changes > 0) {
      logger.info({ chatId }, 'Session deleted');
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

  findByChannel(channelType: string, channelId?: string): SessionRecord[] {
    const db = sqliteManager.getDatabase();
    let query = 'SELECT * FROM sessions WHERE channel_type = ?';
    const params: Array<string> = [channelType];

    if (channelId) {
      query += ' AND channel_id = ?';
      params.push(channelId);
    }

    query += ' ORDER BY created_at DESC';
    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as SessionRow[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  upsert(input: CreateSessionInput): SessionRecord {
    const existing = this.findByChatId(input.chatId);
    if (existing) {
      return this.update(input.chatId, input) || existing;
    }
    return this.create(input);
  }

  private mapRowToRecord(row: SessionRow): SessionRecord {
    return {
      chatId: row.chat_id,
      channelType: row.channel_type,
      channelId: row.channel_id,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
}

export const sessionRepository = new SessionRepository();
