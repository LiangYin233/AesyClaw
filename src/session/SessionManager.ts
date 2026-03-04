import { join } from 'path';
import { randomUUID } from 'crypto';
import type { LLMMessage } from '../types.js';
import { Database, type DBSession, type DBMessage } from '../db/index.js';
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface Session {
  key: string;
  id?: number;
  channel: string;
  chatId: string;
  uuid?: string;
  messages: SessionMessage[];
  createdAt: Date;
  updatedAt: Date;
  lastConsolidated: number;
}

export class SessionManager {
  private db: Database;
  private sessions: Map<string, Session> = new Map();
  private maxSessions: number;
  private sessionLocks: Map<string, Promise<Session>> = new Map();
  private log = logger.child({ prefix: 'SessionManager' });

  constructor(storageDir: string, maxSessions: number = CONSTANTS.DEFAULT_MAX_SESSIONS) {
    this.maxSessions = maxSessions;
    const dbPath = join(storageDir, 'sessions.db');
    this.db = new Database(dbPath);
    this.log.info(`Initialized with SQLite: ${dbPath}`);
  }

  async ready(): Promise<void> {
    await this.db.ready();
  }

  createSessionKey(channel: string, chatId: string, uuid?: string): string {
    if (uuid) {
      return `${channel}:${chatId}:${uuid}`;
    }
    return `${channel}:${chatId}`;
  }

  parseSessionKey(key: string): { channel: string; chatId: string; uuid?: string } {
    const parts = key.split(':');
    if (parts.length >= 3) {
      return { channel: parts[0], chatId: parts[1], uuid: parts[2] };
    }
    return { channel: parts[0], chatId: parts[1] };
  }

  createNewSession(channel: string, chatId: string): string {
    const uuid = randomUUID().substring(0, 8);
    const key = this.createSessionKey(channel, chatId, uuid);
    this.log.debug(`Creating new session: ${key}`);
    return key;
  }

  /**
   * Get an existing session or create a new one.
   * @param key - The session key (format: channel:chatId or channel:chatId:uuid)
   * @returns The existing or newly created session
   */
  async getOrCreate(key: string): Promise<Session> {
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const pending = this.sessionLocks.get(key);
    if (pending) {
      return pending;
    }

    const lockPromise = this.doGetOrCreate(key);
    this.sessionLocks.set(key, lockPromise);

    try {
      const session = await lockPromise;
      return session;
    } finally {
      this.sessionLocks.delete(key);
    }
  }

  private async doGetOrCreate(key: string): Promise<Session> {
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const parsed = this.parseSessionKey(key);
    const session = await this.load(key);
    
    if (!session) {
      const result = await this.db.run(
        `INSERT INTO sessions (key, channel, chat_id, uuid) VALUES (?, ?, ?, ?)`,
        [key, parsed.channel, parsed.chatId, parsed.uuid || null]
      );
      
      const newSession: Session = {
        key,
        id: result.lastID,
        channel: parsed.channel,
        chatId: parsed.chatId,
        uuid: parsed.uuid,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        lastConsolidated: 0
      };
      this.sessions.set(key, newSession);
      
      if (this.sessions.size >= this.maxSessions * CONSTANTS.SESSION_CLEANUP_THRESHOLD) {
        await this.cleanupOldSessions();
      }
      return newSession;
    }

    this.sessions.set(key, session);
    return session;
  }

  private async cleanupOldSessions(): Promise<void> {
    try {
      const countResult = await this.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM sessions'
      );
      const totalCount = countResult?.count || 0;
      
      if (totalCount > this.maxSessions) {
        const toDelete = totalCount - this.maxSessions;
        const oldSessions = await this.db.all<DBSession>(
          `SELECT key FROM sessions ORDER BY updated_at ASC LIMIT ?`,
          [toDelete]
        );
        
        for (const session of oldSessions) {
          await this.delete(session.key);
          this.log.debug(`Cleanup: removed old session ${session.key}`);
        }
      }
    } catch (error) {
      this.log.warn('Failed to cleanup old sessions:', error);
    }
  }

  private mapRowToSession(row: DBSession, messages: DBMessage[]): Session {
    return {
      key: row.key,
      id: row.id,
      channel: row.channel,
      chatId: row.chat_id,
      uuid: row.uuid || undefined,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: m.timestamp
      })),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastConsolidated: 0
    };
  }

  private async load(key: string): Promise<Session | null> {
    const rows = await this.db.all<DBSession>(
      `SELECT * FROM sessions WHERE key = ?`,
      [key]
    );

    if (rows.length === 0) return null;

    const messages = await this.db.all<DBMessage>(
      `SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC`,
      [rows[0].id]
    );

    return this.mapRowToSession(rows[0], messages);
  }

  async save(session: Session): Promise<void> {
    session.updatedAt = new Date();
    await this.db.run(
      `UPDATE sessions SET updated_at = ? WHERE key = ?`,
      [session.updatedAt.toISOString(), session.key]
    );
  }

  async addMessage(key: string, role: 'user' | 'assistant' | 'system', content: string): Promise<void> {
    const session = await this.getOrCreate(key);
    
    session.messages.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });

    if (session.id) {
      await this.db.run(
        `INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)`,
        [session.id, role, content]
      );
    }

    await this.save(session);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  async delete(key: string): Promise<void> {
    this.sessions.delete(key);
    await this.db.run(`DELETE FROM sessions WHERE key = ?`, [key]);
  }

  count(): number {
    return this.sessions.size;
  }

  async loadAll(): Promise<void> {
    await this.db.ready();
    
    const sessions = await this.db.all<DBSession>(
      `SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`,
      [this.maxSessions]
    );

    const batchSize = CONSTANTS.SESSION_LOAD_BATCH_SIZE;
    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize);
      const rowsWithMessages = await Promise.all(
        batch.map(async (row) => ({
          row,
          messages: await this.db.all<DBMessage>(
            `SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC`,
            [row.id]
          )
        }))
      );
      
      for (const { row, messages } of rowsWithMessages) {
        this.sessions.set(row.key, this.mapRowToSession(row, messages));
      }
    }

    this.log.info(`Loaded ${this.sessions.size} sessions from database`);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
