import { join } from 'path';
import { randomUUID } from 'crypto';
import { Database, type DBSession, type DBMessage, type DBSessionMemory, type DBMemoryFact } from '../db/index.js';
import { logger } from '../logger/index.js';
import { CONSTANTS, CONFIG_DEFAULTS } from '../constants/index.js';
import { metrics } from '../logger/Metrics.js';

/**
 * Parse a session key into its components
 * Format: "channel:chatId" or "channel:chatId:uuid"
 */
function parseSessionKey(key: string): { channel: string; chatId: string; uuid?: string } {
  const parts = key.split(':');
  if (parts.length >= 3) {
    return { channel: parts[0], chatId: parts[1], uuid: parts[2] };
  }
  return { channel: parts[0], chatId: parts[1] };
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface MemoryFact {
  content: string;
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
  private facts: Map<string, MemoryFact[]> = new Map();
  private maxSessions: number;
  private sessionLocks: Map<string, Promise<Session>> = new Map();
  private log = logger.child({ prefix: 'SessionManager' });

  constructor(storageDir: string, maxSessions: number = CONFIG_DEFAULTS.DEFAULT_MAX_SESSIONS) {
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

  createNewSession(channel: string, chatId: string): string {
    const uuid = randomUUID().substring(0, 8);
    const key = this.createSessionKey(channel, chatId, uuid);
    this.log.debug(`Creating new session: ${key}`);
    return key;
  }

  async getOrCreate(key: string): Promise<Session> {
    const existing = this.sessions.get(key);  // 尝试从内存中获取现有会话
    if (existing) {
      this.log.debug(`Session found in memory: ${key}, messages: ${existing.messages.length}`);
      return existing;
    }

    const pending = this.sessionLocks.get(key);  // 检查是否有正在创建的会话
    if (pending) {
      this.log.debug(`Session creation pending: ${key}`);
      return await pending;
    }

    this.log.debug(`Creating new session: ${key}`);
    const lockPromise = this.doGetOrCreate(key);  // 创建新会话的异步操作
    this.sessionLocks.set(key, lockPromise);  // 添加锁防止并发创建

    try {
      const session = await lockPromise;
      return session;
    } finally {
      this.sessionLocks.delete(key);  // 完成后删除锁
    }
  }

  private async doGetOrCreate(key: string): Promise<Session> {
    const endTimer = metrics.timer('session.load_time', { operation: 'doGetOrCreate' });

    try {
      const existing = this.sessions.get(key);
      if (existing) {
        return existing;
      }

      const parsed = parseSessionKey(key);  // 解析会话键
      const session = await this.load(key);  // 从数据库加载会话

      if (!session) {
        const result = await this.db.run(  // 数据库中插入新会话
          `INSERT INTO sessions (key, channel, chat_id, uuid) VALUES (?, ?, ?, ?)`,
          [key, parsed.channel, parsed.chatId, parsed.uuid || null]
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
        this.sessions.set(key, newSession);  // 添加到内存缓存

        if (this.sessions.size >= this.maxSessions * CONSTANTS.SESSION_CLEANUP_THRESHOLD) {
          await this.cleanupOldSessions();  // 超过阈值时清理旧会话
        }
        return newSession;
      }

      this.sessions.set(key, session);
      return session;
    } finally {
      endTimer();
    }
  }

  private async cleanupOldSessions(): Promise<void> {
    try {
      const countResult = await this.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM sessions'
      );
      const totalCount = countResult?.count ?? 0;
      
      if (totalCount > this.maxSessions) {
        const toDelete = totalCount - this.maxSessions;
        const oldSessions = await this.db.all<DBSession>(
          `SELECT key FROM sessions ORDER BY updated_at ASC LIMIT ?`,
          [toDelete]
        );

        for (const session of oldSessions) {
          await this.delete(session.key);
        }

        if (oldSessions.length > 0) {
          this.log.info(`Cleaned up ${oldSessions.length} old sessions (max: ${this.maxSessions})`);
        }
      }
    } catch (error) {
      this.log.warn('Failed to cleanup old sessions:', error);
    }
  }

  private mapRowToSession(row: DBSession, messages: DBMessage[], memory?: DBSessionMemory): Session {
    return {
      key: row.key,
      id: row.id,
      channel: row.channel,
      chatId: row.chat_id,
      uuid: row.uuid || undefined,
      summary: memory?.summary || '',
      summarizedMessageCount: memory?.summarized_message_count || 0,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: m.timestamp
      })),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
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

    const memory = await this.db.get<DBSessionMemory>(
      `SELECT * FROM session_memory WHERE session_id = ?`,
      [rows[0].id]
    );

    return this.mapRowToSession(rows[0], messages, memory);
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

    const message: SessionMessage = {
      role,
      content,
      timestamp: new Date().toISOString()
    };

    session.messages.push(message);
    this.log.debug(`Added ${role} message to session ${key}, total messages: ${session.messages.length}, content length: ${content.length}`);

    if (session.id) {
      const timestamp = message.timestamp;
      await this.db.transaction(async () => {
        await this.db.run(
          `INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
          [session.id!, role, content, timestamp]
        );
        await this.db.run(
          `UPDATE sessions SET updated_at = ? WHERE key = ?`,
          [new Date().toISOString(), key]
        );
      });
    }
  }

  async getFacts(channel: string, chatId: string): Promise<MemoryFact[]> {
    const conversationKey = this.createSessionKey(channel, chatId);
    const cached = this.facts.get(conversationKey);
    if (cached) {
      return cached;
    }

    const rows = await this.db.all<DBMemoryFact>(
      `SELECT * FROM memory_facts WHERE channel = ? AND chat_id = ? ORDER BY updated_at DESC, id DESC`,
      [channel, chatId]
    );

    const facts = rows.map((row) => ({ content: row.fact, updatedAt: row.updated_at }));
    this.facts.set(conversationKey, facts);
    return facts;
  }

  async setFacts(channel: string, chatId: string, facts: string[]): Promise<void> {
    const conversationKey = this.createSessionKey(channel, chatId);
    const normalizedFacts = Array.from(new Set(
      facts.map((fact) => fact.trim()).filter(Boolean)
    ));

    await this.db.transaction(async () => {
      await this.db.run(
        `DELETE FROM memory_facts WHERE channel = ? AND chat_id = ?`,
        [channel, chatId]
      );

      const updatedAt = new Date().toISOString();
      for (const fact of normalizedFacts) {
        await this.db.run(
          `INSERT INTO memory_facts (channel, chat_id, fact, updated_at) VALUES (?, ?, ?, ?)`,
          [channel, chatId, fact, updatedAt]
        );
      }
    });

    this.facts.set(
      conversationKey,
      normalizedFacts.map((content) => ({ content, updatedAt: new Date().toISOString() }))
    );
  }

  async updateSummary(key: string, summary: string, summarizedMessageCount: number): Promise<void> {
    const session = await this.getOrCreate(key);
    session.summary = summary;
    session.summarizedMessageCount = summarizedMessageCount;
    session.updatedAt = new Date();

    if (session.id) {
      await this.db.transaction(async () => {
        await this.db.run(
          `INSERT INTO session_memory (session_id, summary, summarized_message_count, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             summary = excluded.summary,
             summarized_message_count = excluded.summarized_message_count,
             updated_at = excluded.updated_at`,
          [session.id, summary, summarizedMessageCount, session.updatedAt.toISOString()]
        );
        await this.db.run(
          `UPDATE sessions SET updated_at = ? WHERE key = ?`,
          [session.updatedAt.toISOString(), key]
        );
      });
    }
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  async delete(key: string): Promise<void> {
    const session = this.sessions.get(key);
    this.sessions.delete(key);
    if (session) {
      this.facts.delete(this.createSessionKey(session.channel, session.chatId));
    }
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
          ),
          memory: await this.db.get<DBSessionMemory>(
            `SELECT * FROM session_memory WHERE session_id = ?`,
            [row.id]
          )
        }))
      );
      
      for (const { row, messages, memory } of rowsWithMessages) {
        this.sessions.set(row.key, this.mapRowToSession(row, messages, memory));
      }
    }

    this.log.info(`Loaded ${this.sessions.size} sessions from database`);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
