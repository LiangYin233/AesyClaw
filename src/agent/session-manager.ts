/**
 * SessionManager — manages session contexts for active conversations.
 *
 * Each unique SessionKey maps to a SessionContext containing:
 * - A DatabaseManager-backed session record
 * - An active RoleConfig
 * - An Agent instance
 * - A MemoryManager for conversation history
 *
 */

import type { SessionKey, RoleConfig } from '../core/types';
import type { DatabaseManager } from '../core/database/database-manager';
import type { RoleManager } from '../role/role-manager';
import type { ConfigManager } from '../core/config/config-manager';
import type { AgentEngine } from './agent-engine';
import type { Agent } from './agent-types';
import { MemoryManager } from './memory-manager';
import type { LlmAdapter } from './llm-adapter';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('session');

// ─── Types ──────────────────────────────────────────────────────

/**
 * Session context containing all state for an active session.
 */
export interface SessionContext {
  key: SessionKey;
  sessionId: string;
  activeRole: RoleConfig;
  agent: Agent;
  memory: MemoryManager;
}

/**
 * Dependencies injected into SessionManager on initialization.
 */
export interface SessionManagerDependencies {
  databaseManager: DatabaseManager;
  roleManager: RoleManager;
  agentEngine: AgentEngine;
  configManager: ConfigManager;
  llmAdapter: LlmAdapter;
}

// ─── SessionManager ─────────────────────────────────────────────

export class SessionManager {
  private sessions: Map<string, SessionContext> = new Map();
  private initialized = false;
  private deps: SessionManagerDependencies | null = null;

  // ─── Lifecycle ────────────────────────────────────────────────

  /**
   * Initialize the session manager with its dependencies.
   */
  initialize(deps: SessionManagerDependencies): void {
    if (this.initialized) {
      logger.warn('SessionManager already initialized — skipping');
      return;
    }
    this.deps = deps;
    this.initialized = true;
    logger.info('SessionManager initialized');
  }

  // ─── Session resolution ───────────────────────────────────────

  /**
   * Compute a cache key string from a SessionKey.
   *
   * Format: `${channel}:${type}:${chatId}`
   */
  private computeKey(key: SessionKey): string {
    return `${key.channel}:${key.type}:${key.chatId}`;
  }

  /**
   * Get or create a session context for the given SessionKey.
   *
   * If a session already exists in the Map, return it.
   * Otherwise:
   *   1. Create or find a DB session record via SessionRepository.findOrCreate
   *   2. Load the active role (from role binding or default)
   *   3. Create a MemoryManager for the session
   *   4. Create an Agent via AgentEngine
   *   5. Store in the sessions Map and return
   *
   * @param key - The session key identifying the conversation
   * @returns The session context
   */
  async getOrCreateSession(key: SessionKey): Promise<SessionContext> {
    if (!this.deps) {
      throw new Error('SessionManager not initialized');
    }

    const cacheKey = this.computeKey(key);

    // Check for existing session
    const existing = this.sessions.get(cacheKey);
    if (existing) {
      logger.debug('Session found in cache', { cacheKey });
      return existing;
    }

    // Create or find DB session record
    const sessionRecord = await this.deps.databaseManager.sessions.findOrCreate(key);
    const sessionId = sessionRecord.id;

    // Load active role (from binding or default)
    let roleId = await this.deps.databaseManager.roleBindings.getActiveRole(sessionId);
    let activeRole: RoleConfig;

    if (roleId) {
      activeRole = this.deps.roleManager.getRole(roleId);
    } else {
      activeRole = this.deps.roleManager.getDefaultRole();
    }

    // Get memory config
    const config = this.deps.configManager.getConfig();
    const memoryConfig = {
      maxContextTokens: config.memory.maxContextTokens,
      compressionThreshold: config.memory.compressionThreshold,
    };

    // Create MemoryManager
    const memory = new MemoryManager(
      sessionId,
      this.deps.databaseManager.messages,
      memoryConfig,
    );

    // Create Agent
    const agent = this.deps.agentEngine.createAgent(activeRole, sessionId, memory, {
      sessionKey: key,
    });

    // Build and store session context
    const context: SessionContext = {
      key,
      sessionId,
      activeRole,
      agent,
      memory,
    };

    this.sessions.set(cacheKey, context);
    logger.info('Session created', { cacheKey, roleId: activeRole.id });

    return context;
  }

  /**
   * Get an existing session context, or undefined if not found.
   *
   * @param key - The session key to look up
   */
  getSession(key: SessionKey): SessionContext | undefined {
    const cacheKey = this.computeKey(key);
    return this.sessions.get(cacheKey);
  }

  // ─── Session operations ───────────────────────────────────────

  /**
   * Clear a session's history and remove it from the active sessions.
   *
   * - Clears the session's message history via MemoryManager
   * - Removes the session from the cache Map
   *
   * @param key - The session key to clear
   */
  async clearSession(key: SessionKey): Promise<void> {
    if (!this.deps) {
      throw new Error('SessionManager not initialized');
    }

    const cacheKey = this.computeKey(key);
    const session = this.sessions.get(cacheKey);

    if (session) {
      // Clear message history via MemoryManager
      await session.memory.clear();
      // Remove from cache
      this.sessions.delete(cacheKey);
      logger.info('Session cleared', { cacheKey });
    } else {
      logger.debug('Session not found for clearing', { cacheKey });
    }
  }

  /**
   * Compact a session's conversation history.
   *
   * Delegates to MemoryManager.compact() which summarizes the
   * conversation via the LLM and replaces it in the database.
   *
   * @param key - The session key to compact
   * @returns The summary text
   */
  async compactSession(key: SessionKey): Promise<string> {
    if (!this.deps) {
      throw new Error('SessionManager not initialized');
    }

    const cacheKey = this.computeKey(key);
    const session = this.sessions.get(cacheKey);

    if (!session) {
      throw new Error(`Session not found: ${cacheKey}`);
    }

    const summary = await session.memory.compact(this.deps.llmAdapter, session.activeRole.model);
    logger.info('Session compacted', { cacheKey });
    return summary;
  }

  /**
   * Switch the active role for a session.
   *
   * - Get the new role from RoleManager
   * - Update the role binding in the database
   * - Create a new agent with the new role
   * - Update the session context
   *
   * @param key - The session key to switch role for
   * @param roleId - The new role ID to switch to
   */
  async switchRole(key: SessionKey, roleId: string): Promise<void> {
    if (!this.deps) {
      throw new Error('SessionManager not initialized');
    }

    const cacheKey = this.computeKey(key);
    const session = this.sessions.get(cacheKey);

    if (!session) {
      throw new Error(`Session not found: ${cacheKey}`);
    }

    // Get the new role config
    const newRole = this.deps.roleManager.getRole(roleId);

    // Update role binding in database
    await this.deps.databaseManager.roleBindings.setActiveRole(session.sessionId, roleId);

    // Create a new agent with the new role
    const newAgent = this.deps.agentEngine.createAgent(newRole, session.sessionId, session.memory, {
      sessionKey: key,
    });

    // Update session context
    session.activeRole = newRole;
    session.agent = newAgent;

    logger.info('Session role switched', { cacheKey, roleId });
  }
}
