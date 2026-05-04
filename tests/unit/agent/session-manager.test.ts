/**
 * SessionManager unit tests.
 *
 * Tests cover: getOrCreateSession (creates new, returns existing),
 * getSession, clearSession, switchRole, compactSession.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../../src/agent/session-manager';
import type { SessionManagerDependencies } from '../../../src/agent/session-manager';
import type { SessionKey, RoleConfig } from '../../../src/core/types';
import type { DatabaseManager } from '../../../src/core/database/database-manager';
import type { RoleManager } from '../../../src/role/role-manager';
import type { AgentEngine } from '../../../src/agent/agent-engine';
import type { ConfigManager } from '../../../src/core/config/config-manager';
import type { LlmAdapter } from '../../../src/agent/llm-adapter';
import type { Agent } from '../../../src/agent/agent-types';
import type { AppConfig } from '../../../src/core/config/schema';

// ─── Helpers ──────────────────────────────────────────────────────

function makeSessionKey(overrides: Partial<SessionKey> = {}): SessionKey {
  return {
    channel: 'test-channel',
    type: 'private',
    chatId: 'user-123',
    ...overrides,
  };
}

function makeRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    id: 'default',
    name: 'Default',
    description: 'Test role',
    systemPrompt: 'You are a test assistant.',
    model: 'openai/gpt-4o',
    toolPermission: { mode: 'allowlist', list: ['*'] },
    skills: ['*'],
    enabled: true,
    ...overrides,
  };
}

function makeMockAgent(): Agent {
  return {
    state: {
      systemPrompt: 'You are a test assistant.',
      model: {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        api: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
        modelId: 'gpt-4o',
        apiType: 'openai-responses',
      },
      tools: [],
      messages: [],
      thinkingLevel: 'low',
      isStreaming: false,
      pendingToolCalls: new Set(),
    },
    prompt: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    abort: vi.fn(),
    continue: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn(),
    steer: vi.fn(),
    clearSteeringQueue: vi.fn(),
    clearFollowUpQueue: vi.fn(),
    clearAllQueues: vi.fn(),
    hasQueuedMessages: vi.fn().mockReturnValue(false),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

function makeMockDeps(
  overrides: Partial<SessionManagerDependencies> = {},
): SessionManagerDependencies {
  const mockConfig = {
    server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
    providers: {
      openai: { apiType: 'openai-responses', apiKey: 'test-key' },
    },
    channels: {},
    agent: {
      memory: { compressionThreshold: 0.8 },
      multimodal: {
        speechToText: { provider: 'openai', model: 'whisper-1' },
        imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
      },
    },
    mcp: [],
    plugins: [],
  } as AppConfig;

  const sessionRepo = {
    findOrCreate: vi.fn().mockResolvedValue({
      id: 'session-uuid',
      channel: 'test-channel',
      type: 'private',
      chatId: 'user-123',
    }),
  };

  const messageRepo = {
    save: vi.fn().mockResolvedValue(undefined),
    loadHistory: vi.fn().mockResolvedValue([]),
    clearHistory: vi.fn().mockResolvedValue(undefined),
    replaceWithSummary: vi.fn().mockResolvedValue(undefined),
  };

  const roleBindingRepo = {
    getActiveRole: vi.fn().mockResolvedValue(null),
    setActiveRole: vi.fn().mockResolvedValue(undefined),
  };

  const mockDB = {
    sessions: sessionRepo,
    messages: messageRepo,
    roleBindings: roleBindingRepo,
  } as unknown as DatabaseManager;

  const defaultRole = makeRole();

  const mockRoleManager = {
    getRole: vi.fn().mockReturnValue(defaultRole),
    getDefaultRole: vi.fn().mockReturnValue(defaultRole),
    getEnabledRoles: vi.fn().mockReturnValue([defaultRole]),
  } as unknown as RoleManager;

  const mockAgent = makeMockAgent();

  const mockAgentEngine = {
    createAgent: vi.fn().mockReturnValue(mockAgent),
  } as unknown as AgentEngine;

  const mockConfigManager = {
    getConfig: vi.fn().mockReturnValue(mockConfig),
  } as unknown as ConfigManager;

  const mockLlmAdapter = {
    resolveModel: vi.fn().mockReturnValue({ contextWindow: 128000 }),
  } as unknown as LlmAdapter;

  return {
    databaseManager: mockDB,
    roleManager: mockRoleManager,
    agentEngine: mockAgentEngine,
    configManager: mockConfigManager,
    llmAdapter: mockLlmAdapter,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('SessionManager', () => {
  let manager: SessionManager;
  let deps: SessionManagerDependencies;

  beforeEach(async () => {
    manager = new SessionManager();
    deps = makeMockDeps();
    await manager.initialize(deps);
  });

  // ─── getOrCreateSession ───────────────────────────────────────

  describe('getOrCreateSession', () => {
    it('should create a new session when none exists', async () => {
      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      expect(session).toBeDefined();
      expect(session.key).toEqual(key);
      expect(session.sessionId).toBe('session-uuid');
      expect(session.activeRole.id).toBe('default');
      expect(session.agent).toBeDefined();
      // MemoryManager is instantiated with the session's message repo
      expect(session.memory).toBeDefined();
      expect(typeof session.memory.loadHistory).toBe('function');

      // DB session was created
      expect(deps.databaseManager.sessions.findOrCreate).toHaveBeenCalledWith(key);
    });

    it('should return existing session from cache on second call', async () => {
      const key = makeSessionKey();
      const session1 = await manager.getOrCreateSession(key);
      const session2 = await manager.getOrCreateSession(key);

      expect(session1).toBe(session2); // Same object reference
      // findOrCreate should only be called once
      expect(deps.databaseManager.sessions.findOrCreate).toHaveBeenCalledTimes(1);
    });

    it('should share pending creation for concurrent calls with the same key', async () => {
      const key = makeSessionKey();
      let resolveFindOrCreate:
        | ((
            value: Awaited<
              ReturnType<SessionManagerDependencies['databaseManager']['sessions']['findOrCreate']>
            >,
          ) => void)
        | null = null;
      (deps.databaseManager.sessions.findOrCreate as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFindOrCreate = resolve;
          }),
      );

      const first = manager.getOrCreateSession(key);
      const second = manager.getOrCreateSession(key);

      expect(deps.databaseManager.sessions.findOrCreate).toHaveBeenCalledTimes(1);
      resolveFindOrCreate?.({
        id: 'session-uuid',
        channel: key.channel,
        type: key.type,
        chatId: key.chatId,
      });

      const [session1, session2] = await Promise.all([first, second]);

      expect(session1).toBe(session2);
      expect(deps.agentEngine.createAgent).toHaveBeenCalledTimes(1);
    });

    it('should use role binding from DB if available', async () => {
      (
        deps.databaseManager.roleBindings.getActiveRole as ReturnType<typeof vi.fn>
      ).mockResolvedValue('custom-role');

      const customRole = makeRole({ id: 'custom-role', name: 'Custom Role' });
      (deps.roleManager.getRole as ReturnType<typeof vi.fn>).mockReturnValue(customRole);

      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      expect(session.activeRole.id).toBe('custom-role');
    });

    it('should fall back to default role when no binding exists', async () => {
      (
        deps.databaseManager.roleBindings.getActiveRole as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);

      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      expect(session.activeRole.id).toBe('default');
      expect(deps.roleManager.getDefaultRole).toHaveBeenCalled();
    });

    it('should throw if not initialized', async () => {
      const uninitialized = new SessionManager();
      await expect(uninitialized.getOrCreateSession(makeSessionKey())).rejects.toThrow(
        'SessionManager 未初始化',
      );
    });
  });

  // ─── getSession ───────────────────────────────────────────────

  describe('getSession', () => {
    it('should return undefined for non-existent session', () => {
      const key = makeSessionKey();
      expect(manager.getSession(key)).toBeUndefined();
    });

    it('should return existing session after getOrCreateSession', async () => {
      const key = makeSessionKey();
      await manager.getOrCreateSession(key);
      const session = manager.getSession(key);
      expect(session).toBeDefined();
      expect(session?.key).toEqual(key);
    });

    it('should return different sessions for different keys', async () => {
      const key1 = makeSessionKey({ chatId: 'user-1' });
      const key2 = makeSessionKey({ chatId: 'user-2' });
      const session1 = await manager.getOrCreateSession(key1);
      const session2 = await manager.getOrCreateSession(key2);
      expect(session1).not.toBe(session2);
    });

    it('should not collide when session key fields contain delimiters', async () => {
      const key1 = makeSessionKey({ channel: 'a:b', type: 'c', chatId: 'd' });
      const key2 = makeSessionKey({ channel: 'a', type: 'b:c', chatId: 'd' });

      (deps.databaseManager.sessions.findOrCreate as ReturnType<typeof vi.fn>).mockImplementation(
        async (key: SessionKey) => ({
          id: `${key.channel}|${key.type}|${key.chatId}`,
          channel: key.channel,
          type: key.type,
          chatId: key.chatId,
        }),
      );

      const session1 = await manager.getOrCreateSession(key1);
      const session2 = await manager.getOrCreateSession(key2);

      expect(session1).not.toBe(session2);
      expect(session1.sessionId).toBe('a:b|c|d');
      expect(session2.sessionId).toBe('a|b:c|d');
      expect(deps.databaseManager.sessions.findOrCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('agent processing busy state', () => {
    it('should reject a second begin for the same session key until released', () => {
      const key = makeSessionKey();

      expect(manager.isAgentProcessing(key)).toBe(false);
      expect(manager.tryBeginAgentProcessing(key)).toBe(true);
      expect(manager.isAgentProcessing(key)).toBe(true);
      expect(manager.tryBeginAgentProcessing(key)).toBe(false);

      manager.endAgentProcessing(key);

      expect(manager.isAgentProcessing(key)).toBe(false);
      expect(manager.tryBeginAgentProcessing(key)).toBe(true);
    });

    it('should isolate busy state by complete session key', () => {
      const key = makeSessionKey();
      const sameChannelDifferentChat = makeSessionKey({ chatId: 'user-456' });
      const differentChannel = makeSessionKey({ channel: 'other-channel' });
      const cronKey = makeSessionKey({ channel: 'cron', type: 'job', chatId: 'job-1' });

      expect(manager.tryBeginAgentProcessing(key)).toBe(true);

      expect(manager.isAgentProcessing(sameChannelDifferentChat)).toBe(false);
      expect(manager.isAgentProcessing(differentChannel)).toBe(false);
      expect(manager.isAgentProcessing(cronKey)).toBe(false);
      expect(manager.tryBeginAgentProcessing(sameChannelDifferentChat)).toBe(true);
      expect(manager.tryBeginAgentProcessing(differentChannel)).toBe(true);
      expect(manager.tryBeginAgentProcessing(cronKey)).toBe(true);
    });
  });

  describe('clearCachedSessions', () => {
    it('should evict cached sessions without clearing persisted history', async () => {
      const key = makeSessionKey();
      await manager.getOrCreateSession(key);

      manager.clearCachedSessions();

      expect(manager.getSession(key)).toBeUndefined();
      expect(deps.databaseManager.messages.clearHistory).not.toHaveBeenCalled();
    });
  });

  // ─── clearSession ─────────────────────────────────────────────

  describe('clearSession', () => {
    it('should clear session history and remove from cache', async () => {
      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      // Spy on memory.clear
      const clearSpy = vi.spyOn(session.memory, 'clear').mockResolvedValue(undefined);

      await manager.clearSession(key);

      expect(clearSpy).toHaveBeenCalled();
      expect(manager.getSession(key)).toBeUndefined();
    });

    it('should be a no-op if session does not exist', async () => {
      const key = makeSessionKey();
      await expect(manager.clearSession(key)).resolves.toBeUndefined();
    });

    it('should throw if not initialized', async () => {
      const uninitialized = new SessionManager();
      await expect(uninitialized.clearSession(makeSessionKey())).rejects.toThrow(
        'SessionManager 未初始化',
      );
    });
  });

  // ─── compactSession ───────────────────────────────────────────

  describe('resetSession', () => {
    it('should clear persisted history, reset the role, and evict cache', async () => {
      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      await manager.resetSession(key);

      expect(deps.databaseManager.messages.clearHistory).toHaveBeenCalledWith(session.sessionId);
      expect(deps.databaseManager.roleBindings.setActiveRole).toHaveBeenCalledWith(
        session.sessionId,
        'default',
      );
      expect(manager.getSession(key)).toBeUndefined();
    });

    it('should reset uncached sessions by resolving the backing session record', async () => {
      const key = makeSessionKey({ chatId: 'uncached-user' });

      await manager.resetSession(key);

      expect(deps.databaseManager.sessions.findOrCreate).toHaveBeenCalledWith(key);
      expect(deps.databaseManager.messages.clearHistory).toHaveBeenCalledWith('session-uuid');
    });

    it('should throw if not initialized', async () => {
      const uninitialized = new SessionManager();
      await expect(uninitialized.resetSession(makeSessionKey())).rejects.toThrow(
        'SessionManager 未初始化',
      );
    });
  });

  describe('compactSession', () => {
    it('should compact session history via memory manager', async () => {
      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      // Override memory.loadHistory to return enough messages for compaction
      const longHistory = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : ('assistant' as const),
        ...(i % 2 === 0
          ? { content: `Message ${i + 1}` }
          : {
              content: [{ type: 'text' as const, text: `Message ${i + 1}` }],
              api: 'openai-responses' as const,
              provider: 'openai',
              model: 'gpt-4o',
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: 'stop' as const,
            }),
        timestamp: Date.now(),
      }));
      vi.spyOn(session.memory, 'loadHistory').mockResolvedValue(longHistory);
      vi.spyOn(session.memory, 'compact').mockResolvedValue('Summary of conversation');

      const summary = await manager.compactSession(key);
      expect(summary).toBe('Summary of conversation');
      expect(session.memory.compact).toHaveBeenCalledWith(
        deps.llmAdapter,
        session.activeRole.model,
      );
    });

    it('should throw if session not found', async () => {
      const key = makeSessionKey();
      await expect(manager.compactSession(key)).rejects.toThrow('未找到会话');
    });

    it('should throw if not initialized', async () => {
      const uninitialized = new SessionManager();
      await expect(uninitialized.compactSession(makeSessionKey())).rejects.toThrow(
        'SessionManager 未初始化',
      );
    });
  });

  // ─── switchRole ──────────────────────────────────────────────

  describe('switchRole', () => {
    it('should update role binding in DB and create new agent', async () => {
      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      const newRole = makeRole({ id: 'analyst', name: 'Analyst' });
      (deps.roleManager.getRole as ReturnType<typeof vi.fn>).mockReturnValue(newRole);

      const newAgent = makeMockAgent();
      (deps.agentEngine.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(newAgent);

      await manager.switchRole(key, 'analyst');

      expect(deps.databaseManager.roleBindings.setActiveRole).toHaveBeenCalledWith(
        session.sessionId,
        'analyst',
      );
      expect(deps.roleManager.getRole).toHaveBeenCalledWith('analyst');
      expect(deps.agentEngine.createAgent).toHaveBeenCalledWith(
        newRole,
        session.sessionId,
        expect.any(Object),
      );
      expect(session.activeRole.id).toBe('analyst');
    });

    it('should persist the resolved role id if role lookup falls back', async () => {
      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);
      const fallbackRole = makeRole({ id: 'default', name: 'Default' });

      (deps.roleManager.getRole as ReturnType<typeof vi.fn>).mockReturnValue(fallbackRole);

      await manager.switchRole(key, 'missing');

      expect(deps.databaseManager.roleBindings.setActiveRole).toHaveBeenCalledWith(
        session.sessionId,
        'default',
      );
      expect(session.activeRole.id).toBe('default');
    });

    it('should throw if session not found', async () => {
      const key = makeSessionKey();
      await expect(manager.switchRole(key, 'analyst')).rejects.toThrow('未找到会话');
    });

    it('should throw if not initialized', async () => {
      const uninitialized = new SessionManager();
      await expect(uninitialized.switchRole(makeSessionKey(), 'analyst')).rejects.toThrow(
        'SessionManager 未初始化',
      );
    });
  });
});
