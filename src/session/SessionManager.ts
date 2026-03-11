import { join } from 'path';
import { randomUUID } from 'crypto';
import { Database, type DBSession, type DBMessage, type DBSessionMemory, type DBSessionAgentState } from '../db/index.js';
import { logger } from '../logger/index.js';
import { CONSTANTS, CONFIG_DEFAULTS } from '../constants/index.js';
import { metrics } from '../logger/Metrics.js';

function parseSessionKey(key: string): { channel: string; chatId: string; uuid?: string } {
  const parts = key.split(':');
  if (parts.length >= 3) {
    return { channel: parts[0], chatId: parts[1], uuid: parts.slice(2).join(':') };
  }
  return { channel: parts[0], chatId: parts[1] };
}

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
  agentName?: string;
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

  getDatabase(): Database {
    return this.db;
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
    this.log.debug(`Generated new session key: ${key}`);
    return key;
  }

  async getOrCreate(key: string): Promise<Session> {
    const existing = this.sessions.get(key);
    if (existing) {
      this.log.debug(`Session found in memory: ${key}, messages: ${existing.messages.length}`);
      return existing;
    }

    const pending = this.sessionLocks.get(key);
    if (pending) {
      this.log.debug(`Session creation pending: ${key}`);
      return await pending;
    }

    this.log.debug(`Creating session record: ${key}`);
    const lockPromise = this.doGetOrCreate(key);
    this.sessionLocks.set(key, lockPromise);

    try {
      return await lockPromise;
    } finally {
      this.sessionLocks.delete(key);
    }
  }

  private async doGetOrCreate(key: string): Promise<Session> {
    const endTimer = metrics.timer('session.load_time', { operation: 'doGetOrCreate' });

    try {
      const existing = this.sessions.get(key);
      if (existing) {
        return existing;
      }

      const parsed = parseSessionKey(key);
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
          agentName: undefined,
          summary: '',
          summarizedMessageCount: 0,
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date()
        };
        this.sessions.set(key, newSession);

        if (this.sessions.size >= this.maxSessions * CONSTANTS.SESSION_CLEANUP_THRESHOLD) {
          await this.cleanupOldSessions();
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
      const countResult = await this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM sessions');
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

  private mapRowToSession(
    row: DBSession,
    messages: DBMessage[],
    memory?: DBSessionMemory,
    agentState?: DBSessionAgentState
  ): Session {
    return {
      key: row.key,
      id: row.id,
      channel: row.channel,
      chatId: row.chat_id,
      uuid: row.uuid || undefined,
      agentName: agentState?.agent_name || undefined,
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
    const [messages, memory, agentState] = await Promise.all([
      this.db.all<DBMessage>(`SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC`, [row.id]),
      this.db.get<DBSessionMemory>(`SELECT * FROM session_memory WHERE session_id = ?`, [row.id]),
      this.db.get<DBSessionAgentState>(`SELECT * FROM session_agent_state WHERE session_id = ?`, [row.id])
    ]);

    return this.mapRowToSession(row, messages, memory, agentState);
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
    const timestamp = updatedAt.toISOString();

    const message: SessionMessage = {
      role,
      content,
      timestamp
    };

    session.messages.push(message);
    session.updatedAt = updatedAt;
    this.log.debug(`Added ${role} message to session ${key}, total messages: ${session.messages.length}, content length: ${content.length}`);

    if (session.id) {
      await this.db.transaction(async () => {
        await this.db.run(
          `INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
          [session.id, role, content, timestamp]
        );
        await this.db.run(`UPDATE sessions SET updated_at = ? WHERE key = ?`, [timestamp, key]);
      });
    }
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

  async getSessionAgent(key: string): Promise<string | null> {
    const session = await this.getOrCreate(key);
    if (!session.id) {
      return session.agentName || null;
    }

    const row = await this.db.get<DBSessionAgentState>(
      `SELECT * FROM session_agent_state WHERE session_id = ?`,
      [session.id]
    );

    session.agentName = row?.agent_name || undefined;
    return session.agentName || null;
  }

  async setSessionAgent(key: string, agentName: string): Promise<void> {
    const session = await this.getOrCreate(key);
    if (!session.id) {
      return;
    }

    session.agentName = agentName;
    await this.db.run(
      `INSERT INTO session_agent_state (session_id, agent_name, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(session_id) DO UPDATE SET
         agent_name = excluded.agent_name,
         updated_at = excluded.updated_at`,
      [session.id, agentName]
    );
  }

  async clearSessionAgent(key: string): Promise<void> {
    const session = await this.getOrCreate(key);
    if (!session.id) {
      return;
    }

    session.agentName = undefined;
    await this.db.run(`DELETE FROM session_agent_state WHERE session_id = ?`, [session.id]);
  }

  async deleteAgentBindings(agentName: string): Promise<number> {
    for (const session of this.sessions.values()) {
      if (session.agentName === agentName) {
        session.agentName = undefined;
      }
    }

    const result = await this.db.run(`DELETE FROM session_agent_state WHERE agent_name = ?`, [agentName]);
    return result.changes;
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
      const loadedSessions = await Promise.all(
        batch.map(async (row) => [row.key, await this.loadSessionData(row)] as const)
      );

      for (const [loadedKey, session] of loadedSessions) {
        this.sessions.set(loadedKey, session);
      }
    }

    this.log.info(`Loaded ${this.sessions.size} sessions from database`);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
