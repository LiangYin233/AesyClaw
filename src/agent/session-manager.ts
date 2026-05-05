/**
 * SessionManager — 管理活跃会话的会话上下文。
 *
 * 每个唯一的 SessionKey 映射到一个包含以下内容的 SessionContext：
 * - 基于 DatabaseManager 的会话记录
 * - 活跃的 RoleConfig
 * - Agent 实例
 * - 用于对话历史的 MemoryManager
 *
 */

import type { SessionKey, RoleConfig } from '@aesyclaw/core/types';
import { serializeSessionKey } from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { AgentEngine } from './agent-engine';
import type { Agent } from './agent-types';
import { MemoryManager } from './memory-manager';
import type { LlmAdapter } from './llm-adapter';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('session-manager');
export const AGENT_PROCESSING_BUSY_MESSAGE = 'Agent处理任务中。';

// ─── 类型 ──────────────────────────────────────────────────────

/**
 * 包含活跃会话所有状态的会话上下文。
 */
export type SessionContext = {
  key: SessionKey;
  sessionId: string;
  activeRole: RoleConfig;
  agent: Agent;
  memory: MemoryManager;
};

/**
 * 初始化时注入 SessionManager 的依赖。
 */
// ─── SessionManager ─────────────────────────────────────────────

export class SessionManager {
  private sessions: Map<string, SessionContext> = new Map();
  private pendingSessions: Map<string, Promise<SessionContext>> = new Map();
  private agentProcessingSessions: Set<string> = new Set();

  constructor(
    private databaseManager: DatabaseManager,
    private roleManager: RoleManager,
    private agentEngine: AgentEngine,
    private configManager: ConfigManager,
    private llmAdapter: LlmAdapter,
  ) {}

  // ─── 会话解析 ───────────────────────────────────────

  /**
   * 获取或创建给定 SessionKey 的会话上下文。
   *
   * 如果 Map 中已存在会话，则返回它。
   * 否则：
   *   1. 通过 SessionRepository.findOrCreate 创建或查找数据库会话记录
   *   2. 加载活跃角色（从角色绑定或默认）
   *   3. 为会话创建 MemoryManager
   *   4. 通过 AgentEngine 创建 Agent
   *   5. 存储到 sessions Map 并返回
   *
   * @param key - 标识对话的会话键
   * @returns 会话上下文
   */
  async getOrCreateSession(key: SessionKey): Promise<SessionContext> {
    const cacheKey = serializeSessionKey(key);

    // 检查现有会话
    const existing = this.sessions.get(cacheKey);
    if (existing) {
      logger.debug('在缓存中找到会话', { cacheKey });
      return existing;
    }

    const pending = this.pendingSessions.get(cacheKey);
    if (pending) {
      logger.debug('会话创建已在进行中', { cacheKey });
      return await pending;
    }

    const creation = this.createSessionContext(key, cacheKey);
    this.pendingSessions.set(cacheKey, creation);

    try {
      return await creation;
    } finally {
      this.pendingSessions.delete(cacheKey);
    }
  }

  private async createSessionContext(key: SessionKey, cacheKey: string): Promise<SessionContext> {
    // 创建或查找数据库会话记录
    const sessionRecord = await this.databaseManager.sessions.findOrCreate(key);
    const sessionId = sessionRecord.id;

    // 加载活跃角色（从绑定或默认）
    const roleId = await this.databaseManager.roleBindings.getActiveRole(sessionId);
    let activeRole: RoleConfig;

    if (roleId) {
      activeRole = this.roleManager.getRole(roleId);
    } else {
      activeRole = this.roleManager.getDefaultRole();
    }

    // 解析模型以从其上下文窗口推导内存配置
    const resolvedModel = this.llmAdapter.resolveModel(activeRole.model);

    // 获取内存配置（compressionThreshold 来自配置，maxContextTokens 来自模型）
    const config = this.configManager.getConfig();
    const memoryConfig = {
      maxContextTokens: resolvedModel.contextWindow,
      compressionThreshold: config.agent.memory.compressionThreshold,
    };

    // 创建 MemoryManager
    const memory = new MemoryManager(
      sessionId,
      this.databaseManager.messages,
      memoryConfig,
      this.databaseManager.usage,
      this.databaseManager.toolUsage,
    );

    // 创建 Agent
    const agent = this.agentEngine.createAgent(activeRole, sessionId, {
      sessionKey: key,
    });

    // 构建并存储会话上下文
    const context: SessionContext = {
      key,
      sessionId,
      activeRole,
      agent,
      memory,
    };

    this.sessions.set(cacheKey, context);
    logger.info('会话已创建', { cacheKey, roleId: activeRole.id });

    return context;
  }

  /**
   * 获取现有会话上下文，如果未找到则返回 undefined。
   *
   * @param key - 要查找的会话键
   */
  getSession(key: SessionKey): SessionContext | undefined {
    const cacheKey = serializeSessionKey(key);
    return this.sessions.get(cacheKey);
  }

  isAgentProcessing(key: SessionKey): boolean {
    return this.agentProcessingSessions.has(serializeSessionKey(key));
  }

  tryBeginAgentProcessing(key: SessionKey): boolean {
    const cacheKey = serializeSessionKey(key);
    if (this.agentProcessingSessions.has(cacheKey)) {
      return false;
    }

    this.agentProcessingSessions.add(cacheKey);
    return true;
  }

  endAgentProcessing(key: SessionKey): void {
    this.agentProcessingSessions.delete(serializeSessionKey(key));
  }

  /**
   * 逐出所有内存中的会话上下文，但不删除持久化的历史。
   *
   * 在角色文件热重载时使用，以便下一条消息使用当前角色提示词、模型、工具权限和内存设置重新创建 Agent。
   */
  clearCachedSessions(): void {
    const count = this.sessions.size;
    this.sessions.clear();
    this.agentProcessingSessions.clear();
    if (count > 0) {
      logger.info('会话缓存已清除', { count });
    }
  }

  // ─── 会话操作 ───────────────────────────────────────

  /**
   * 清除会话历史并将其从活跃会话中移除。
   *
   * - 通过 MemoryManager 清除会话的消息历史
   * - 从缓存 Map 中移除会话
   *
   * @param key - 要清除的会话键
   */
  async clearSession(key: SessionKey): Promise<void> {
    const cacheKey = serializeSessionKey(key);
    const session = this.sessions.get(cacheKey);

    if (session) {
      // 通过 MemoryManager 清除消息历史
      await session.memory.clear();
      // 从缓存中移除
      this.sessions.delete(cacheKey);
      logger.info('会话已清除', { cacheKey });
    } else {
      logger.debug('未找到要清除的会话', { cacheKey });
    }
  }

  /**
   * 将会话重置为全新历史和当前默认角色。
   *
   * 与 clearSession() 不同，这会始终解析后端数据库会话，因此
   * 即使会话当前未被缓存，也可以清除持久化的历史。
   */
  async resetSession(key: SessionKey): Promise<void> {
    const cacheKey = serializeSessionKey(key);
    const sessionRecord = await this.databaseManager.sessions.findOrCreate(key);
    const defaultRole = this.roleManager.getDefaultRole();

    await this.databaseManager.messages.clearHistory(sessionRecord.id);
    await this.databaseManager.roleBindings.setActiveRole(sessionRecord.id, defaultRole.id);

    this.sessions.delete(cacheKey);
    logger.info('会话已重置', { cacheKey, roleId: defaultRole.id });
  }

  /**
   * 压缩会话的对话历史。
   *
   * 委托给 MemoryManager.compact()，该方法通过
   * LLM 总结对话并在数据库中替换它。
   *
   * @param key - 要压缩的会话键
   * @returns 总结文本
   */
  async compactSession(key: SessionKey): Promise<string> {
    const cacheKey = serializeSessionKey(key);
    const session = this.sessions.get(cacheKey);

    if (!session) {
      throw new Error(`未找到会话: ${cacheKey}`);
    }

    const summary = await session.memory.compact(this.llmAdapter, session.activeRole.model);
    logger.info('会话已压缩', { cacheKey });
    return summary;
  }

  /**
   * 切换会话的活跃角色。
   *
   * - 从 RoleManager 获取新角色
   * - 更新数据库中的角色绑定
   * - 使用新角色创建新 Agent
   * - 更新会话上下文
   *
   * @param key - 要切换角色的会话键
   * @param roleId - 要切换到的新角色 ID
   */
  async switchRole(key: SessionKey, roleId: string): Promise<void> {
    const cacheKey = serializeSessionKey(key);
    const session = this.sessions.get(cacheKey);

    if (!session) {
      throw new Error(`未找到会话: ${cacheKey}`);
    }

    // 获取新角色配置
    const newRole = this.roleManager.getRole(roleId);

    // 更新数据库中的角色绑定
    await this.databaseManager.roleBindings.setActiveRole(session.sessionId, newRole.id);

    // 使用新角色创建新 Agent
    const newAgent = this.agentEngine.createAgent(newRole, session.sessionId, {
      sessionKey: key,
    });

    // 更新会话上下文
    session.activeRole = newRole;
    session.agent = newAgent;

    logger.info('会话角色已切换', { cacheKey, roleId: newRole.id });
  }
}
