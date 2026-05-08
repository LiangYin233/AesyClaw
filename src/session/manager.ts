import { serializeSessionKey, type SessionKey } from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { Session } from './session';

const logger = createScopedLogger('session-manager');

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private pendingSessions: Map<string, Promise<Session>> = new Map();

  constructor(private databaseManager: DatabaseManager) {}

  async create(key: SessionKey): Promise<Session> {
    const cacheKey = serializeSessionKey(key);

    const existing = this.sessions.get(cacheKey);
    if (existing) return existing;

    const pending = this.pendingSessions.get(cacheKey);
    if (pending) return await pending;

    const creation = this.createFromDb(key, cacheKey);
    this.pendingSessions.set(cacheKey, creation);

    try {
      return await creation;
    } finally {
      this.pendingSessions.delete(cacheKey);
    }
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  clearCache(): void {
    const count = this.sessions.size;
    this.sessions.clear();
    if (count > 0) {
      logger.info('会话缓存已清除', { count });
    }
  }

  get(key: SessionKey): Session | undefined {
    const cacheKey = serializeSessionKey(key);
    return this.sessions.get(cacheKey);
  }

  isLocked(key: SessionKey): boolean {
    const s = this.sessions.get(serializeSessionKey(key));
    return s ? s.isLocked : false;
  }

  async clear(key: SessionKey): Promise<void> {
    const cacheKey = serializeSessionKey(key);
    const session = this.sessions.get(cacheKey);
    if (session) {
      await session.clear();
      this.sessions.delete(cacheKey);
    }
  }

  private async createFromDb(key: SessionKey, cacheKey: string): Promise<Session> {
    const sessionRecord = await this.databaseManager.sessions.findOrCreate(key);
    const session = new Session(sessionRecord.id, key, {
      messages: this.databaseManager.messages,
      usage: this.databaseManager.usage,
      toolUsage: this.databaseManager.toolUsage,
    });
    await session.bind();
    this.sessions.set(cacheKey, session);
    logger.info('会话已创建', { cacheKey });
    return session;
  }
}
