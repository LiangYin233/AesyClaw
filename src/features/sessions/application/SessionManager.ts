import type { Database } from '../../../platform/db/index.js';
import { logger } from '../../../platform/observability/index.js';
import { createShortId } from '../../../platform/ids/index.js';
import { formatLocalTimestamp } from '../../../platform/observability/logging.js';
import { parseSessionKey, normalizeSessionError, SessionNotFoundError, SessionValidationError, type Session, type SessionMessage } from '../domain/types.js';
import { SessionStore } from '../infrastructure/SessionStore.js';

const DEFAULT_MAX_SESSIONS = 100;
const SESSION_CLEANUP_THRESHOLD = 0.9;
const SESSION_LOAD_BATCH_SIZE = 10;

export { type Session, type SessionMessage };

export class SessionManager {
  private store: SessionStore;
  private sessions: Map<string, Session> = new Map();
  private maxSessions: number;
  private sessionLocks: Map<string, Promise<Session>> = new Map();
  private log = logger.child('SessionManager');

  constructor(db: Database, maxSessions: number = DEFAULT_MAX_SESSIONS) {
    this.maxSessions = maxSessions;
    this.store = new SessionStore(db);
  }

  async ready(): Promise<void> {
    await this.store.ready();
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
    const uuid = createShortId();
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
      const lastID = await this.store.insertSession(key, parsed.channel, parsed.chatId, parsed.uuid || null, createdAt);

      const newSession: Session = {
        key,
        id: lastID,
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
      const totalCount = await this.store.countSessions();

      if (totalCount > this.maxSessions) {
        const toDelete = totalCount - this.maxSessions;
        const oldSessions = await this.store.findOldestSessions(toDelete);

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
    row: { key: string; id: number; channel: string; chat_id: string; uuid: string | null; created_at: string; updated_at: string },
    messages: { role: string; content: string; timestamp?: string }[],
    memory?: { summary?: string; summarized_message_count?: number }
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

  private async loadSessionData(row: { key: string; id: number; channel: string; chat_id: string; uuid: string | null; created_at: string; updated_at: string }): Promise<Session> {
    const { messages, memory } = await this.store.loadSessionData(row);
    return this.mapRowToSession(row, messages, memory);
  }

  private async load(key: string): Promise<Session | null> {
    const row = await this.store.loadSession(key);
    if (!row) {
      return null;
    }
    return this.loadSessionData(row);
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
      await this.store.addMessage(session.id, role, content, timestamp, key);
    }

    session.messages.push(message);
    session.updatedAt = updatedAt;
  }

  async updateSummary(key: string, summary: string, summarizedMessageCount: number): Promise<void> {
    const session = await this.getOrCreate(key);
    const nextUpdatedAt = new Date();
    const updatedAt = formatLocalTimestamp(nextUpdatedAt);

    if (session.id) {
      await this.store.upsertSummary(session.id, summary, summarizedMessageCount, updatedAt, key);
    }

    session.summary = summary;
    session.summarizedMessageCount = summarizedMessageCount;
    session.updatedAt = nextUpdatedAt;
  }

  async getConversationMessages(channel: string, chatId: string): Promise<{ id: number; sessionId: number; sessionKey: string; role: 'user' | 'assistant' | 'system'; content: string; timestamp?: string }[]> {
    const rows = await this.store.getConversationMessages(channel, chatId);
    return rows.map((row: { id: number; session_id: number; session_key: string; role: string; content: string; timestamp: string }) => ({
      id: row.id,
      sessionId: row.session_id,
      sessionKey: row.session_key,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      timestamp: row.timestamp
    }));
  }

  async getConversationMemory(channel: string, chatId: string): Promise<{ channel: string; chatId: string; summary: string; summarizedUntilMessageId: number; updatedAt?: string }> {
    const row = await this.store.getConversationMemory(channel, chatId);
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
    await this.store.updateConversationSummary(channel, chatId, summary, summarizedUntilMessageId, updatedAt);
  }

  async clearSummary(key: string): Promise<void> {
    const session = await this.getOrCreate(key);
    session.summary = '';
    session.summarizedMessageCount = 0;

    if (session.id) {
      await this.store.deleteSummary(session.id);
    }
  }

  async clearAllSummaries(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.summary = '';
      session.summarizedMessageCount = 0;
    }

    await this.store.deleteAllSummaries();
  }

  async clearConversationSummaries(channel: string, chatId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.channel === channel && session.chatId === chatId) {
        session.summary = '';
        session.summarizedMessageCount = 0;
      }
    }

    await this.store.deleteSummariesForConversation(channel, chatId);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  async delete(key: string): Promise<void> {
    this.sessions.delete(key);
    await this.store.deleteSession(key);
  }

  count(): number {
    return this.sessions.size;
  }

  async loadAll(): Promise<void> {
    await this.store.ready();

    const sessions = await this.store.loadAllSessions(this.maxSessions);

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
    await this.store.close();
  }
}
