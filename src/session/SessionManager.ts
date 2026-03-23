import { join } from 'path';
import { randomUUID } from 'crypto';
import { Database, type DBConversationMemory, type DBMessage, type DBSession, type DBSessionMemory } from '../db/index.js';
import { logger } from '../observability/index.js';
import { formatLocalTimestamp } from '../observability/logging.js';
import { normalizeSessionError, SessionNotFoundError, SessionValidationError } from './errors.js';

const DEFAULT_MAX_SESSIONS = 100;
const SESSION_CLEANUP_THRESHOLD = 0.9;
const SESSION_LOAD_BATCH_SIZE = 10;

function parseSessionKey(key: string): { channel: string; chatId: string; uuid?: string } {
  const parts = key.split(':');
  const channel = parts[0]?.trim();
  const chatId = parts[1]?.trim();

  if (!channel || !chatId) {
    throw new SessionValidationError('session key must use format "channel:chatId[:uuid]"', {
      field: 'key',
      key
    });
  }

  if (parts.length >= 3) {
    const uuid = parts.slice(2).join(':').trim();
    return { channel, chatId, ...(uuid ? { uuid } : {}) };
  }

  return { channel, chatId };
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface ConversationMessage extends SessionMessage {
  id: number;
  sessionKey: string;
  sessionId: number;
}

export interface ConversationMemory {
  channel: string;
  chatId: string;
  summary: string;
  summarizedUntilMessageId: number;
  updatedAt?: string;
}

export interface Session {
  key: string;
  id?: number;
  channel: string;
  chatId: string;
  uuid?: string;
  summary: string;
  summarizedMessageCount: number;
  messages: SessionMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export class SessionManager {
  private db: Database;
  private sessions: Map<string, Session> = new Map();
  private maxSessions: number;
  private sessionLocks: Map<string, Promise<Session>> = new Map();
  private log = logger.child('SessionManager');

  constructor(storageDir: string, maxSessions: number = DEFAULT_MAX_SESSIONS) {
    this.maxSessions = maxSessions;
    const dbPath = join(storageDir, 'sessions.db');
    this.db = new Database(dbPath);
    this.log.info(`SQLite 已初始化: ${dbPath}`);
  }

  async ready(): Promise<void> {
    await this.db.ready();
  }

  getDatabase(): Database {
    return this.db;
  }

  static validateSessionKey(key: string): void {
    parseSessionKey(key);
  }

  createSessionKey(channel: string, chatId: string, uuid?: string): string {
    if (uuid) {
      return `${channel}:${chatId}:${uuid}`;
    }
    return `${channel}:${chatId}`;
  }

  createNewSession(channel: string, chatId: string): string {
    const uuid = randomUUID().substring(0, 8);
    const key = this.createSessionKey(channel, chatId, uuid);
    return key;
  }

  async getOrCreate(key: string): Promise<Session> {
    parseSessionKey(key);

    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const pending = this.sessionLocks.get(key);
    if (pending) {
      return await pending;
    }

    const lockPromise = this.doGetOrCreate(key);
    this.sessionLocks.set(key, lockPromise);

    try {
      return await lockPromise;
    } finally {
      this.sessionLocks.delete(key);
    }
  }

  async get(key: string): Promise<Session | null> {
    parseSessionKey(key);

    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const pending = this.sessionLocks.get(key);
    if (pending) {
      return await pending;
    }

    const session = await this.load(key);
    if (session) {
      this.sessions.set(key, session);
    }

    return session;
  }

  async getExistingOrThrow(key: string): Promise<Session> {
    const session = await this.get(key);
    if (!session) {
      throw new SessionNotFoundError(key);
    }
    return session;
  }

  private async doGetOrCreate(key: string): Promise<Session> {
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const parsed = parseSessionKey(key);
    const session = await this.load(key);

    if (!session) {
      const createdAt = formatLocalTimestamp(new Date());
      const result = await this.db.run(
        `INSERT INTO sessions (key, channel, chat_id, uuid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [key, parsed.channel, parsed.chatId, parsed.uuid || null, createdAt, createdAt]
      );

      const newSession: Session = {
        key,
        id: result.lastID,
        channel: parsed.channel,
        chatId: parsed.chatId,
        uuid: parsed.uuid,
        summary: '',
        summarizedMessageCount: 0,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.sessions.set(key, newSession);
      this.log.info('会话已创建', {
        sessionKey: key,
        channel: parsed.channel,
        chatId: parsed.chatId
      });

      if (this.sessions.size >= this.maxSessions * SESSION_CLEANUP_THRESHOLD) {
        await this.cleanupOldSessions();
      }
      return newSession;
    }

    this.sessions.set(key, session);
    return session;
  }

  private async cleanupOldSessions(): Promise<void> {
    try {
      const countResult = await this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM sessions');
      const totalCount = countResult?.count ?? 0;

      if (totalCount > this.maxSessions) {
        const toDelete = totalCount - this.maxSessions;
        const oldSessions = await this.db.all<DBSession>(
          `SELECT key FROM sessions ORDER BY datetime(updated_at) ASC LIMIT ?`,
          [toDelete]
        );

        for (const session of oldSessions) {
          await this.delete(session.key);
        }

        if (oldSessions.length > 0) {
          this.log.info(`已清理 ${oldSessions.length} 个旧会话 (上限: ${this.maxSessions})`);
        }
      }
    } catch (error) {
      this.log.warn('清理旧会话失败', {
        error: normalizeSessionError(error)
      });
    }
  }

  private mapRowToSession(
    row: DBSession,
    messages: DBMessage[],
    memory?: DBSessionMemory
  ): Session {
    return {
      key: row.key,
      id: row.id,
      channel: row.channel,
      chatId: row.chat_id,
      uuid: row.uuid || undefined,
      summary: memory?.summary || '',
      summarizedMessageCount: memory?.summarized_message_count || 0,
      messages: messages.map((message) => ({
        role: message.role as 'user' | 'assistant' | 'system',
        content: message.content,
        timestamp: message.timestamp
      })),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  private async loadSessionData(row: DBSession): Promise<Session> {
    const [messages, memory] = await Promise.all([
      this.db.all<DBMessage>(`SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC`, [row.id]),
      this.db.get<DBSessionMemory>(`SELECT * FROM session_memory WHERE session_id = ?`, [row.id])
    ]);

    return this.mapRowToSession(row, messages, memory);
  }

  private async load(key: string): Promise<Session | null> {
    const rows = await this.db.all<DBSession>(`SELECT * FROM sessions WHERE key = ?`, [key]);

    if (rows.length === 0) {
      return null;
    }

    return this.loadSessionData(rows[0]);
  }

  async addMessage(key: string, role: 'user' | 'assistant' | 'system', content: string): Promise<void> {
    const session = await this.getOrCreate(key);
    const updatedAt = new Date();
    const timestamp = formatLocalTimestamp(updatedAt);

    const message: SessionMessage = {
      role,
      content,
      timestamp
    };

    if (session.id) {
      await this.db.transaction(async () => {
        await this.db.run(
          `INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
          [session.id, role, content, timestamp]
        );
        await this.db.run(`UPDATE sessions SET updated_at = ? WHERE key = ?`, [timestamp, key]);
      });
    }

    session.messages.push(message);
    session.updatedAt = updatedAt;
  }

  async updateSummary(key: string, summary: string, summarizedMessageCount: number): Promise<void> {
    const session = await this.getOrCreate(key);
    const nextUpdatedAt = new Date();
    const updatedAt = formatLocalTimestamp(nextUpdatedAt);

    if (session.id) {
      await this.db.transaction(async () => {
        await this.db.run(
          `INSERT INTO session_memory (session_id, summary, summarized_message_count, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             summary = excluded.summary,
             summarized_message_count = excluded.summarized_message_count,
             updated_at = excluded.updated_at`,
          [session.id, summary, summarizedMessageCount, updatedAt]
        );
        await this.db.run(
          `UPDATE sessions SET updated_at = ? WHERE key = ?`,
          [updatedAt, key]
        );
      });
    }

    session.summary = summary;
    session.summarizedMessageCount = summarizedMessageCount;
    session.updatedAt = nextUpdatedAt;
  }

  async getConversationMessages(channel: string, chatId: string): Promise<ConversationMessage[]> {
    return this.db.all<{
      id: number;
      session_id: number;
      session_key: string;
      role: string;
      content: string;
      timestamp: string;
    }>(
      `SELECT
         m.id,
         m.session_id,
         s.key as session_key,
         m.role,
         m.content,
         m.timestamp
       FROM messages m
       INNER JOIN sessions s ON s.id = m.session_id
       WHERE s.channel = ? AND s.chat_id = ?
       ORDER BY m.id ASC`,
      [channel, chatId]
    ).then((rows) => rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sessionKey: row.session_key,
      role: row.role as SessionMessage['role'],
      content: row.content,
      timestamp: row.timestamp
    })));
  }

  async getConversationMemory(channel: string, chatId: string): Promise<ConversationMemory> {
    const row = await this.db.get<DBConversationMemory>(
      `SELECT * FROM conversation_memory WHERE channel = ? AND chat_id = ?`,
      [channel, chatId]
    );

    return {
      channel,
      chatId,
      summary: row?.summary || '',
      summarizedUntilMessageId: row?.summarized_until_message_id || 0,
      updatedAt: row?.updated_at
    };
  }

  async updateConversationSummary(
    channel: string,
    chatId: string,
    summary: string,
    summarizedUntilMessageId: number
  ): Promise<void> {
    const updatedAt = formatLocalTimestamp(new Date());
    await this.db.run(
      `INSERT INTO conversation_memory (channel, chat_id, summary, summarized_until_message_id, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel, chat_id) DO UPDATE SET
         summary = excluded.summary,
         summarized_until_message_id = excluded.summarized_until_message_id,
         updated_at = excluded.updated_at`,
      [channel, chatId, summary, summarizedUntilMessageId, updatedAt]
    );
  }

  async clearSummary(key: string): Promise<void> {
    const session = await this.getOrCreate(key);
    session.summary = '';
    session.summarizedMessageCount = 0;

    if (session.id) {
      await this.db.run(`DELETE FROM session_memory WHERE session_id = ?`, [session.id]);
    }
  }

  async clearAllSummaries(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.summary = '';
      session.summarizedMessageCount = 0;
    }

    await this.db.run(`DELETE FROM session_memory`);
    await this.db.run(`DELETE FROM conversation_memory`);
  }

  async clearConversationSummaries(channel: string, chatId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.channel === channel && session.chatId === chatId) {
        session.summary = '';
        session.summarizedMessageCount = 0;
      }
    }

    await this.db.run(
      `DELETE FROM session_memory
       WHERE session_id IN (
         SELECT id FROM sessions WHERE channel = ? AND chat_id = ?
       )`,
      [channel, chatId]
    );
    await this.db.run(`DELETE FROM conversation_memory WHERE channel = ? AND chat_id = ?`, [channel, chatId]);
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
      `SELECT * FROM sessions ORDER BY datetime(updated_at) DESC LIMIT ?`,
      [this.maxSessions]
    );

    const batchSize = SESSION_LOAD_BATCH_SIZE;
    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize);
      const loadedSessions = await Promise.all(
        batch.map(async (row) => [row.key, await this.loadSessionData(row)] as const)
      );

      for (const [loadedKey, session] of loadedSessions) {
        this.sessions.set(loadedKey, session);
      }
    }

    this.log.info(`已从数据库加载 ${this.sessions.size} 个会话`);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
