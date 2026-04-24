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
import type { MemoryManager } from '../../../src/agent/memory-manager';
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

function makeMockDeps(overrides: Partial<SessionManagerDependencies> = {}): SessionManagerDependencies {
  const mockConfig = {
    server: { port: 3000, host: '0.0.0.0', logLevel: 'info', cors: true },
    providers: {
      openai: { apiType: 'openai_responses', apiKey: 'test-key' },
    },
    channels: {},
    agent: { maxSteps: 10 },
    memory: { maxContextTokens: 128000, compressionThreshold: 0.8 },
    multimodal: { speechToText: { provider: 'openai', model: 'whisper-1' }, imageUnderstanding: { provider: 'openai', model: 'gpt-4o' } },
    mcp: [],
    plugins: [],
  } as AppConfig;

  const sessionRepo = {
    findOrCreate: vi.fn().mockResolvedValue({
      id: 'session-uuid',
      channel: 'test-channel',
      type: 'private',
      chatId: 'user-123',
      createdAt: new Date().toISOString(),
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
    summarize: vi.fn().mockResolvedValue('Summary of conversation'),
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

  beforeEach(() => {
    manager = new SessionManager();
    deps = makeMockDeps();
    manager.initialize(deps);
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

    it('should use role binding from DB if available', async () => {
      (deps.databaseManager.roleBindings.getActiveRole as ReturnType<typeof vi.fn>)
        .mockResolvedValue('custom-role');

      const customRole = makeRole({ id: 'custom-role', name: 'Custom Role' });
      (deps.roleManager.getRole as ReturnType<typeof vi.fn>)
        .mockReturnValue(customRole);

      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      expect(session.activeRole.id).toBe('custom-role');
    });

    it('should fall back to default role when no binding exists', async () => {
      (deps.databaseManager.roleBindings.getActiveRole as ReturnType<typeof vi.fn>)
        .mockResolvedValue(null);

      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      expect(session.activeRole.id).toBe('default');
      expect(deps.roleManager.getDefaultRole).toHaveBeenCalled();
    });

    it('should throw if not initialized', async () => {
      const uninitialized = new SessionManager();
      await expect(uninitialized.getOrCreateSession(makeSessionKey())).rejects.toThrow(
        'SessionManager not initialized',
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
        'SessionManager not initialized',
      );
    });
  });

  // ─── compactSession ───────────────────────────────────────────

  describe('compactSession', () => {
    it('should compact session history via memory manager', async () => {
      const key = makeSessionKey();
      const session = await manager.getOrCreateSession(key);

      // Override memory.loadHistory to return enough messages for compaction
      const longHistory = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant' as const,
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
      expect(session.memory.compact).toHaveBeenCalledWith(deps.llmAdapter);
    });

    it('should throw if session not found', async () => {
      const key = makeSessionKey();
      await expect(manager.compactSession(key)).rejects.toThrow('Session not found');
    });

    it('should throw if not initialized', async () => {
      const uninitialized = new SessionManager();
      await expect(uninitialized.compactSession(makeSessionKey())).rejects.toThrow(
        'SessionManager not initialized',
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
        session.memory,
        expect.any(Object),
      );
      expect(session.activeRole.id).toBe('analyst');
    });

    it('should throw if session not found', async () => {
      const key = makeSessionKey();
      await expect(manager.switchRole(key, 'analyst')).rejects.toThrow('Session not found');
    });

    it('should throw if not initialized', async () => {
      const uninitialized = new SessionManager();
      await expect(uninitialized.switchRole(makeSessionKey(), 'analyst')).rejects.toThrow(
        'SessionManager not initialized',
      );
    });
  });
});
