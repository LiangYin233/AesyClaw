import { serializeSessionKey, type SessionKey } from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { Session } from './session';

const logger = createScopedLogger('session-manager');

/**
 * SessionManager — 会话生命周期管理。
 *
 * 负责会话的创建、缓存、查询和清理。
 * 使用两阶段缓存：活跃缓存（已创建会话）+ 待处理缓存（正在创建的会话），避免重复创建。
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private pendingSessions: Map<string, Promise<Session>> = new Map();

  /**
   * @param databaseManager - 数据库管理器
   */
  constructor(private databaseManager: DatabaseManager) {}

  /**
   * 获取或创建指定会话键对应的会话。
   *
   * 优先从缓存返回；若不存在则从数据库创建并绑定历史消息。
   * 同一 key 的并发请求由 pendingSessions 去重。
   * @param key - 会话键
   * @returns 会话实例
   */
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

  /**
   * 列出当前缓存中的所有活跃会话。
   * @returns 会话数组
   */
  list(): Session[] {
    return [...this.sessions.values()];
  }

  /**
   * 清除所有缓存的会话实例。
   *
   * 不影响持久化数据。
   */
  clearCache(): void {
    const count = this.sessions.size;
    this.sessions.clear();
    if (count > 0) {
      logger.info('会话缓存已清除', { count });
    }
  }

  /**
   * 按会话键查找缓存的会话。
   * @param key - 会话键
   * @returns 会话实例，若未缓存则返回 undefined
   */
  get(key: SessionKey): Session | undefined {
    const cacheKey = serializeSessionKey(key);
    return this.sessions.get(cacheKey);
  }

  /**
   * 检查指定会话键对应的会话是否被锁定。
   * @param key - 会话键
   * @returns true 表示锁定中
   */
  isLocked(key: SessionKey): boolean {
    const s = this.sessions.get(serializeSessionKey(key));
    return s ? s.isLocked : false;
  }

  /**
   * 清除指定会话的消息历史并从缓存中移除。
   * @param key - 会话键
   */
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
