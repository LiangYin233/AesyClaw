import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { AgentEngine } from '../../../src/agent/agent-engine';
import type { AgentEngineDependencies } from '../../../src/agent/agent-engine';
import type { LlmAdapter } from '../../../src/agent/llm-adapter';
import type { RoleConfig, InboundMessage } from '../../../src/core/types';
import { MemoryManager } from '../../../src/agent/memory-manager';
import type { MessageRepository } from '../../../src/core/database/repositories/message-repository';
import type { AgentTool, AgentMessage } from '../../../src/agent/agent-types';
import type { Agent } from '../../../src/agent/agent-types';

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

function makeMockMessageRepo(): MessageRepository {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    loadHistory: vi.fn().mockResolvedValue([]),
    clearHistory: vi.fn().mockResolvedValue(undefined),
    replaceWithSummary: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageRepository;
}

function makeAgentTool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: `${name} description`,
    parameters: {},
    execute: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: `${name} result` }],
      details: undefined,
    }),
  };
}

function makeMockLlmAdapter(): LlmAdapter {
  return {
    initialize: vi.fn(),
    resolveModel: vi.fn().mockReturnValue({
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
      apiKey: 'test-key',
    }),
    createStreamFn: vi.fn().mockImplementation(() => {
      return () => {
        const stream = createAssistantMessageEventStream();
        const partial = {
          role: 'assistant' as const,
          content: [],
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
          timestamp: Date.now(),
        };
        const message = {
          ...partial,
          content: [{ type: 'text' as const, text: 'Real response from pi runtime' }],
        };
        stream.push({ type: 'start', partial });
        stream.push({ type: 'text_start', contentIndex: 0, partial: message });
        stream.push({
          type: 'text_delta',
          contentIndex: 0,
          delta: 'Real response from pi runtime',
          partial: message,
        });
        stream.push({
          type: 'text_end',
          contentIndex: 0,
          content: 'Real response from pi runtime',
          partial: message,
        });
        stream.push({ type: 'done', reason: 'stop', message });
        return stream;
      };
    }),
    createGetApiKey: vi
      .fn()
      .mockReturnValue((provider: string) => (provider === 'openai' ? 'test-key' : undefined)),
    summarize: vi.fn().mockResolvedValue('Summary'),
  } as unknown as LlmAdapter;
}

function makeMockPromptBuilder() {
  return {
    buildSystemPrompt: vi.fn().mockImplementation((role: RoleConfig, _ctx?: unknown) => {
      return {
        prompt: role.systemPrompt,
        tools: [] as AgentTool[],
      };
    }),
  };
}

function makeMockRunPolicy() {
  return {
    loadHistoryForTurn: vi.fn().mockResolvedValue([]),
    prompt: vi.fn().mockImplementation(async (agent: Agent, content: string) => {
      // 模拟 pi-agent-core 的行为：添加用户消息和助手响应
      const userMessage: AgentMessage = {
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      const assistantMessage: AgentMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Real response from pi runtime' }],
        api: 'openai-responses',
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
        stopReason: 'stop',
        timestamp: Date.now(),
      };
      agent.state.messages = [...agent.state.messages, userMessage, assistantMessage];
    }),
  };
}

function makeMockDeps(): AgentEngineDependencies {
  const llmAdapter = makeMockLlmAdapter();
  return {
    llmAdapter,
    promptBuilder: makeMockPromptBuilder(),
    runPolicy: makeMockRunPolicy(),
  };
}

describe('AgentEngine', () => {
  let engine: AgentEngine;

  beforeEach(() => {
    engine = new AgentEngine();
    engine.initialize(makeMockDeps());
  });

  describe('createAgent', () => {
    it('should create a pi-backed agent with correct initial state', () => {
      const role = makeRole();

      const agent = engine.createAgent(role, 'test-session');

      expect(agent).toBeDefined();
      expect(agent.state.systemPrompt).toContain('You are a test assistant');
      expect(agent.state.model.provider).toBe('openai');
      expect(agent.state.model.id).toBe('gpt-4o');
      expect(agent.state.messages).toEqual([]);
      expect(agent.state.tools).toEqual([]);
    });

    it('should wire role-resolved tools into the runtime agent state', () => {
      const tool = makeAgentTool('search');
      const deps = makeMockDeps();
      (deps.promptBuilder.buildSystemPrompt as ReturnType<typeof vi.fn>).mockReturnValue({
        prompt: 'You are a test assistant.',
        tools: [tool],
      });

      const runtimeEngine = new AgentEngine();
      runtimeEngine.initialize(deps);

      const role = makeRole();

      const agent = runtimeEngine.createAgent(role, 'test-session');

      expect(agent.state.tools).toHaveLength(1);
      expect(agent.state.tools[0]?.name).toBe('search');
      expect(deps.promptBuilder.buildSystemPrompt).toHaveBeenCalledWith(role, undefined);
    });

    it('should have prompt, waitForIdle, and reset methods', () => {
      const role = makeRole();

      const agent = engine.createAgent(role, 'test-session');

      expect(typeof agent.prompt).toBe('function');
      expect(typeof agent.waitForIdle).toBe('function');
      expect(typeof agent.reset).toBe('function');
    });

    it('should throw if not initialized', () => {
      const uninitialized = new AgentEngine();
      const role = makeRole();

      expect(() => uninitialized.createAgent(role, 'test-session')).toThrow(
        'AgentEngine 未初始化',
      );
    });
  });

  describe('process', () => {
    it('should process a message and return an outbound response', async () => {
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const agent = engine.createAgent(role, 'test-session');
      const result = await engine.process(agent, makeInboundMessage(), memory, role);

      expect(result.content).toBe('Real response from pi runtime');
      expect(messageRepo.save).toHaveBeenCalledTimes(2);
    });

    it('should refresh runtime tools before each turn', async () => {
      const role = makeRole();
      const deps = makeMockDeps();
      const initialTool = makeAgentTool('initial-tool');
      const refreshedTool = makeAgentTool('refreshed-tool');
      (deps.promptBuilder.buildSystemPrompt as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ prompt: role.systemPrompt, tools: [initialTool] })
        .mockReturnValueOnce({ prompt: role.systemPrompt, tools: [refreshedTool] });

      const runtimeEngine = new AgentEngine();
      runtimeEngine.initialize(deps);

      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const agent = runtimeEngine.createAgent(role, 'test-session');
      expect(agent.state.tools[0]?.name).toBe('initial-tool');

      const result = await runtimeEngine.process(agent, makeInboundMessage(), memory, role);

      expect(result.content).toBe('Real response from pi runtime');
      expect(agent.state.tools).toHaveLength(1);
      expect(agent.state.tools[0]?.name).toBe('refreshed-tool');
      expect(deps.promptBuilder.buildSystemPrompt).toHaveBeenNthCalledWith(
        2,
        role,
        {
          sessionKey: makeInboundMessage().sessionKey,
          sendMessage: undefined,
          toolPermission: { mode: 'allowlist', list: ['*'] },
        },
      );
    });

    it('should thread an outbound send callback into runtime tool context when provided', async () => {
      const role = makeRole();
      const deps = makeMockDeps();
      const runtimeEngine = new AgentEngine();
      runtimeEngine.initialize(deps);

      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });
      const agent = runtimeEngine.createAgent(role, 'test-session');
      const sendMessage = vi.fn().mockResolvedValue(true);

      await runtimeEngine.process(agent, makeInboundMessage(), memory, role, sendMessage);

      expect(deps.promptBuilder.buildSystemPrompt).toHaveBeenLastCalledWith(
        role,
        {
          sessionKey: makeInboundMessage().sessionKey,
          sendMessage,
          toolPermission: { mode: 'allowlist', list: ['*'] },
        },
      );
    });

    it('should only persist newly generated messages', async () => {
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      (messageRepo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { role: 'user', content: 'Earlier user', timestamp: '2025-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Earlier assistant', timestamp: '2025-01-01T00:00:01Z' },
      ]);

      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const agent = engine.createAgent(role, 'test-session');
      await engine.process(agent, makeInboundMessage(), memory, role);

      expect(messageRepo.save).toHaveBeenCalledTimes(2);
      expect(messageRepo.save).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({ role: 'user', content: 'Hello, assistant!' }),
      );
      expect(messageRepo.save).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({ role: 'assistant', content: 'Real response from pi runtime' }),
      );
    });

    // maxSteps logic removed
  });

  describe('processEphemeral', () => {
    it('should answer from a persisted memory snapshot without saving or compacting history', async () => {
      const role = makeRole();
      const messageRepo = makeMockMessageRepo();
      (messageRepo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { role: 'user', content: 'Earlier user', timestamp: '2025-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Earlier assistant', timestamp: '2025-01-01T00:00:01Z' },
      ]);
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const sessionKey = makeInboundMessage().sessionKey;
      const result = await engine.processEphemeral({
        sessionKey,
        sessionId: 'test-session',
        memory,
        role,
        content: 'quick aside',
      });

      expect(result.content).toBe('Real response from pi runtime');
      expect(messageRepo.loadHistory).toHaveBeenCalledTimes(1);
      expect(messageRepo.save).not.toHaveBeenCalled();
      expect(messageRepo.replaceWithSummary).not.toHaveBeenCalled();
    });

    it('should create an independent tool-disabled runtime using the current role model', async () => {
      const deps = makeMockDeps();
      const runtimeEngine = new AgentEngine();
      runtimeEngine.initialize(deps);
      const role = makeRole({ toolPermission: { mode: 'allowlist', list: ['search'] } });
      const messageRepo = makeMockMessageRepo();
      const memory = new MemoryManager('test-session', messageRepo, {
        maxContextTokens: 128000,
        compressionThreshold: 0.8,
      });

      const sessionKey = makeInboundMessage().sessionKey;
      await runtimeEngine.processEphemeral({
        sessionKey,
        sessionId: 'test-session',
        memory,
        role,
        content: 'quick aside',
      });

      expect(deps.promptBuilder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          id: role.id,
          model: role.model,
          toolPermission: { mode: 'allowlist', list: [] },
        }),
        {
          sessionKey,
          toolPermission: { mode: 'allowlist', list: [] },
        },
      );
      expect(deps.llmAdapter.resolveModel).toHaveBeenLastCalledWith(role.model);
      expect(messageRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('switchModel', () => {
    it('should update the agent model state', () => {
      const role = makeRole();

      const agent = engine.createAgent(role, 'test-session');
      engine.switchModel(agent, 'openai/gpt-4o');

      expect(agent.state.model.provider).toBe('openai');
      expect(agent.state.model.id).toBe('gpt-4o');
    });
  });
});
