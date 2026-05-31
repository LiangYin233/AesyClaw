import type { AgentMessage } from '@aesyclaw/contracts/llm';
import { serializeSessionKey, type PersistableMessage, type SessionKey } from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { Session } from './core';
import { SessionFileStore } from './file-store';
import { loadAndRehydrateMessages } from './rehydrate';

const logger = createScopedLogger('session-manager');

export type SessionSummary = {
  id: string;
  channel: string;
  type: string;
  chatId: string;
  title: string;
  firstUserMessage?: string;
  messageCount: number;
  lastActivity?: string;
  roleId?: string;
  modelId?: string;
};

type FileSummary = {
  id: string;
  firstUserMessage?: string;
  messageCount: number;
  lastActivity?: string;
};

/**
 * SessionManager — 会话生命周期管理。
 *
 * 负责会话的创建、缓存、查询和清理。
 * 使用两阶段缓存：活跃缓存（已创建会话）+ 待处理缓存（正在创建的会话），避免重复创建。
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private pendingSessions: Map<string, Promise<Session>> = new Map();
  private readonly fileStore: SessionFileStore;

  /**
   * @param databaseManager - 数据库管理器
   * @param getDefaultModel - 获取默认模型（支持热重载）
   * @param getDefaultRoleId - 获取默认角色 ID（支持热重载）
   * @param sessionsDir - 会话 JSON 文件存储目录
   */
  constructor(
    private databaseManager: DatabaseManager,
    private getDefaultModel: () => string,
    private getDefaultRoleId: () => string,
    sessionsDir: string,
  ) {
    this.fileStore = new SessionFileStore(sessionsDir);
  }

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

  async getSummaries(): Promise<SessionSummary[]> {
    const records = await this.databaseManager.sessions.findAll();
    const fileSummaries = await this.readFileSummaries();
    const fileMap = new Map(fileSummaries.map((summary) => [summary.id, summary]));

    return records
      .map((record) => {
        const file = fileMap.get(record.id);
        const title = makeSessionTitle(file?.firstUserMessage ?? '', record.chatId);
        return {
          id: record.id,
          channel: record.channel,
          type: record.type,
          chatId: record.chatId,
          title,
          ...(file?.firstUserMessage !== undefined
            ? { firstUserMessage: file.firstUserMessage }
            : {}),
          messageCount: file?.messageCount ?? 0,
          ...(file?.lastActivity !== undefined ? { lastActivity: file.lastActivity } : {}),
          ...(record.role_id !== undefined ? { roleId: record.role_id } : {}),
          ...(record.model_id !== undefined ? { modelId: record.model_id } : {}),
        } satisfies SessionSummary;
      })
      .sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
  }

  async getMessagesById(id: string): Promise<AgentMessage[]> {
    const record = await this.databaseManager.sessions.findById(id);
    if (!record) {
      throw new Error('会话未找到');
    }
    return await loadAndRehydrateMessages(this.fileStore, id);
  }

  async clearById(id: string): Promise<void> {
    const record = await this.databaseManager.sessions.findById(id);
    if (!record) {
      throw new Error('会话未找到');
    }

    const cacheKey = serializeSessionKey(toSessionKey(record));
    const pending = this.pendingSessions.get(cacheKey);
    const session = this.sessions.get(cacheKey) ?? (pending ? await pending : undefined);
    if (session?.isLocked) {
      logger.warn('无法清除已锁定的会话', { cacheKey });
      throw new Error('会话正在处理中，无法清除历史');
    }

    await this.fileStore.clear(id);
    session?.resetMessages();
    this.sessions.delete(cacheKey);
    this.pendingSessions.delete(cacheKey);
    logger.info('会话历史已清除', { sessionId: id });
  }

  async deleteById(id: string): Promise<boolean> {
    const record = await this.databaseManager.sessions.findById(id);
    if (!record) return false;

    const cacheKey = serializeSessionKey(toSessionKey(record));
    const pending = this.pendingSessions.get(cacheKey);
    const session = this.sessions.get(cacheKey) ?? (pending ? await pending : undefined);
    if (session?.isLocked) {
      logger.warn('无法删除已锁定的会话', { cacheKey });
      throw new Error('会话正在处理中，无法删除');
    }

    await this.fileStore.clear(id);
    const deleted = await this.databaseManager.sessions.deleteById(id);
    this.sessions.delete(cacheKey);
    this.pendingSessions.delete(cacheKey);

    if (deleted) {
      logger.info('会话已删除', { cacheKey });
    }
    return deleted;
  }

  private async createFromDb(key: SessionKey, cacheKey: string): Promise<Session> {
    const sessionRecord = await this.databaseManager.sessions.findOrCreate(key);
    // 新会话自动绑定默认模型和角色
    if (!sessionRecord.model_id) {
      await this.databaseManager.sessions.setModel(sessionRecord.id, this.getDefaultModel());
    }
    if (!sessionRecord.role_id) {
      await this.databaseManager.sessions.setRole(sessionRecord.id, this.getDefaultRoleId());
    }
    const session = new Session(
      sessionRecord.id,
      key,
      this.fileStore,
      this.databaseManager.usage,
      this.databaseManager.toolUsage,
    );
    await session.bind();
    this.sessions.set(cacheKey, session);
    logger.info('会话已创建', { cacheKey });
    return session;
  }

  private async readFileSummaries(): Promise<FileSummary[]> {
    const ids = await this.fileStore.listSessionIds();
    const summaries: FileSummary[] = [];
    for (const id of ids) {
      const messages = await this.fileStore.load(id);
      const summary = createFileSummary(id, messages);
      if (summary) summaries.push(summary);
    }
    return summaries;
  }
}

function createFileSummary(id: string, messages: readonly PersistableMessage[]): FileSummary | null {
  const firstUser = messages.find((message) => message.role === 'user');
  const last = messages[messages.length - 1];
  return {
    id,
    ...(firstUser !== undefined ? { firstUserMessage: firstUser.content } : {}),
    messageCount: messages.length,
    ...(last?.timestamp !== undefined ? { lastActivity: last.timestamp } : {}),
  };
}

function makeSessionTitle(text: string, fallback: string): string {
  const source = text.length > 0 ? text : fallback;
  return source.slice(0, 30);
}

function toSessionKey(record: { channel: string; type: string; chatId: string }): SessionKey {
  return {
    channel: record.channel,
    type: record.type,
    chatId: record.chatId,
  };
}
