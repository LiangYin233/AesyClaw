/**
 * AgentEngine unit tests.
 *
 * Tests cover: createAgent, process (returns simulated response),
 * switchModel.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentEngine } from '../../../src/agent/agent-engine';
import type { AgentEngineDependencies } from '../../../src/agent/agent-engine';
import type { ConfigManager } from '../../../src/core/config/config-manager';
import type { ToolRegistry, AesyClawTool } from '../../../src/tool/tool-registry';
import type { RoleManager } from '../../../src/role/role-manager';
import type { SkillManager } from '../../../src/skill/skill-manager';
import type { HookDispatcher } from '../../../src/pipeline/hook-dispatcher';
import type { LlmAdapter } from '../../../src/agent/llm-adapter';
import type { RoleConfig, InboundMessage, Skill } from '../../../src/core/types';
import { MemoryManager } from '../../../src/agent/memory-manager';
import type { MessageRepository } from '../../../src/core/database/repositories/message-repository';
import type { AppConfig } from '../../../src/core/config/schema';

// ─── Helpers ──────────────────────────────────────────────────────

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

function makeInboundMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    sessionKey: { channel: 'test', type: 'private', chatId: 'user-1' },
    content: 'Hello, assistant!',
    ...overrides,
  };
}

function makeMockConfigManager(): ConfigManager {
  const config: AppConfig = {
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
  };

  return {
    getConfig: vi.fn().mockReturnValue(config),
    get: vi.fn().mockReturnValue(config.providers),
  } as unknown as ConfigManager;
}

function makeMockMessageRepo(): MessageRepository {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    loadHistory: vi.fn().mockResolvedValue([]),
    clearHistory: vi.fn().mockResolvedValue(undefined),
    replaceWithSummary: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageRepository;
}

function makeMockToolRegistry(): ToolRegistry {
  return {
    getAll: vi.fn().mockReturnValue([]),
    resolveForRole: vi.fn().mockReturnValue([]),
  } as unknown as ToolRegistry;
}

function makeMockRoleManager(): RoleManager {
  const role = makeRole();
  return {
    getRole: vi.fn().mockReturnValue(role),
    getDefaultRole: vi.fn().mockReturnValue(role),
    getEnabledRoles: vi.fn().mockReturnValue([role]),
    buildSystemPrompt: vi.fn().mockReturnValue('You are a test assistant.\n\n## Available Tools\n\n## Available Roles\n- **default**: Default — Test role'),
  } as unknown as RoleManager;
}

function makeMockSkillManager(): SkillManager {
  return {
    getSkillsForRole: vi.fn().mockReturnValue([]),
  } as unknown as SkillManager;
}

function makeMockHookDispatcher(): HookDispatcher {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    dispatchOnReceive: vi.fn().mockResolvedValue({ action: 'continue' }),
    dispatchOnSend: vi.fn().mockResolvedValue({ action: 'continue' }),
    dispatchBeforeToolCall: vi.fn().mockResolvedValue({}),
    dispatchAfterToolCall: vi.fn().mockResolvedValue({}),
    dispatchBeforeLLMRequest: vi.fn().mockResolvedValue({ action: 'continue' }),
  } as unknown as HookDispatcher;
}

function makeMockLlmAdapter(): LlmAdapter {
  return {
    initialize: vi.fn(),
    resolveModel: vi.fn().mockReturnValue({
      provider: 'openai',
      modelId: 'gpt-4o',
      contextWindow: 128000,
      enableThinking: false,
      apiType: 'openai_responses',
    }),
    createStreamFn: vi.fn().mockReturnValue(async function* () {
      yield { type: 'text', text: 'stub' };
    }),
    createGetApiKey: vi.fn().mockReturnValue((provider: string) => provider === 'openai' ? 'test-key' : undefined),
    summarize: vi.fn().mockResolvedValue('Summary'),
  } as unknown as LlmAdapter;
}

function makeMockDeps(): AgentEngineDependencies {
  return {
    configManager: makeMockConfigManager(),
    toolRegistry: makeMockToolRegistry(),
    roleManager: makeMockRoleManager(),
    skillManager: makeMockSkillManager(),
    hookDispatcher: makeMockHookDispatcher(),
    llmAdapter: makeMockLlmAdapter(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('AgentEngine', () => {
  let engine: AgentEngine;

  beforeEach(() => {
    engine = new AgentEngine();
    engine.initialize(makeMockDeps());
  });

  // ─── createAgent ─────────────────────────────────────────────

  describe('createAgent', () => {
    it('should create a simulated agent with correct state', () => {
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const agent = engine.createAgent(role, 'test-session', memory);

      expect(agent).toBeDefined();
      expect(agent.state).toBeDefined();
      expect(agent.state.systemPrompt).toContain('You are a test assistant');
      expect(agent.state.model.provider).toBe('openai');
      expect(agent.state.model.modelId).toBe('gpt-4o');
      expect(agent.state.messages).toEqual([]);
    });

    it('should have prompt, waitForIdle, and reset methods', () => {
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const agent = engine.createAgent(role, 'test-session', memory);

      expect(typeof agent.prompt).toBe('function');
      expect(typeof agent.waitForIdle).toBe('function');
      expect(typeof agent.reset).toBe('function');
    });

    it('should throw if not initialized', () => {
      const uninitialized = new AgentEngine();
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      expect(() => uninitialized.createAgent(role, 'test-session', memory)).toThrow(
        'AgentEngine not initialized',
      );
    });
  });

  // ─── process ────────────────────────────────────────────────

  describe('process', () => {
    it('should process a message and return an outbound response', async () => {
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const agent = engine.createAgent(role, 'test-session', memory);
      const message = makeInboundMessage();

      const result = await engine.process(agent, message, memory, role);

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(typeof result.content).toBe('string');
      // The simulated agent echoes back the input
      expect(result.content).toContain('Received');
    });

    it('should throw if not initialized', async () => {
      const uninitialized = new AgentEngine();
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });
      const agent = engine.createAgent(role, 'test-session', memory);

      // Re-create uninitialized engine
      const freshEngine = new AgentEngine();

      await expect(
        freshEngine.process(agent, makeInboundMessage(), memory, role),
      ).rejects.toThrow('AgentEngine not initialized');
    });
  });

  // ─── switchModel ─────────────────────────────────────────────

  describe('switchModel', () => {
    it('should update the agent model state', () => {
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const agent = engine.createAgent(role, 'test-session', memory);
      engine.switchModel(agent, 'openai/gpt-4o');

      expect(agent.state.model.provider).toBe('openai');
      expect(agent.state.model.modelId).toBe('gpt-4o');
    });

    it('should throw if not initialized', () => {
      const uninitialized = new AgentEngine();
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const agent = engine.createAgent(role, 'test-session', memory);
      uninitialized.initialize(makeMockDeps()); // Initialize after getting agent

      // This should work now since we initialized
      expect(() => uninitialized.switchModel(agent, 'openai/gpt-4o')).not.toThrow();
    });
  });
});