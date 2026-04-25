/**
 * Pipeline unit tests.
 *
 * Tests cover: receiveWithSend flow, middleware chain execution order,
 * command detection shortcut, hook blocking, hook respond,
 * and middleware error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Pipeline } from '../../../src/pipeline/pipeline';
import type { Middleware, NextFn, PipelineState } from '../../../src/pipeline/middleware/types';
import type { InboundMessage, OutboundMessage } from '../../../src/core/types';
import type { PluginHooks } from '../../../src/pipeline/middleware/types';
import { CommandRegistry } from '../../../src/command/command-registry';
import { ConfigManager } from '../../../src/core/config/config-manager';
import type { SessionManager } from '../../../src/agent/session-manager';
import type { AgentEngine } from '../../../src/agent/agent-engine';

// ─── Helpers ──────────────────────────────────────────────────────

function makeInbound(content = 'hello'): InboundMessage {
  return {
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
    content,
  };
}

/** Create a minimal ConfigManager that's been loaded */
async function createLoadedConfigManager(): Promise<ConfigManager> {
  const cm = new ConfigManager();
  // Use a temp path for the config file
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-test-'));
  const configPath = path.join(tmpDir, 'config.json');
  await cm.load(configPath);
  return cm;
}

/** Create pipeline deps with real CommandRegistry and loaded ConfigManager */
async function createPipelineDeps() {
  const configManager = await createLoadedConfigManager();

  // Mock SessionManager that returns a minimal session context
  const mockSessionManager = {
    getOrCreateSession: vi.fn().mockResolvedValue({
      key: { channel: 'test', type: 'private', chatId: 'user1' },
      sessionId: 'test-session',
      activeRole: {
        id: 'default',
        name: 'Default',
        description: 'Test role',
        systemPrompt: 'You are a test assistant.',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist' as const, list: ['*'] },
        skills: ['*' as const],
        enabled: true,
      },
      agent: {
        state: {
          systemPrompt: 'You are a test assistant.',
          model: {
            provider: 'openai',
            modelId: 'gpt-4o',
            contextWindow: 128000,
            enableThinking: false,
            apiType: 'openai_responses',
          },
          tools: [],
          messages: [],
        },
        prompt: vi.fn(),
        waitForIdle: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
      },
      memory: {
        loadHistory: vi.fn().mockResolvedValue([]),
        persistMessage: vi.fn().mockResolvedValue(undefined),
        syncFromAgent: vi.fn().mockResolvedValue(undefined),
        compact: vi.fn().mockResolvedValue(''),
        clear: vi.fn().mockResolvedValue(undefined),
      },
    }),
    getSession: vi.fn().mockReturnValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
    compactSession: vi.fn().mockResolvedValue(''),
    switchRole: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionManager;

  // Mock AgentEngine
  const mockAgentEngine = {
    createAgent: vi.fn().mockReturnValue({
      state: {
        systemPrompt: 'You are a test assistant.',
        model: {
          provider: 'openai',
          modelId: 'gpt-4o',
          contextWindow: 128000,
          enableThinking: false,
          apiType: 'openai_responses',
        },
        tools: [],
        messages: [],
      },
      prompt: vi.fn(),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    }),
    process: vi.fn().mockResolvedValue({ content: 'Agent response' }),
    switchModel: vi.fn(),
  } as unknown as AgentEngine;

  return {
    configManager,
    sessionManager: mockSessionManager,
    agentEngine: mockAgentEngine,
    commandRegistry: new CommandRegistry(),
  };
}

/** A simple test middleware that records its execution */
class RecordingMiddleware implements Middleware {
  readonly name: string;
  private orderArr: string[];

  constructor(name: string, orderArr: string[]) {
    this.name = name;
    this.orderArr = orderArr;
  }

  async execute(state: PipelineState, next: NextFn): Promise<PipelineState> {
    this.orderArr.push(this.name);
    return next(state);
  }
}

/** A middleware that sets outbound content */
class SetOutboundMiddleware implements Middleware {
  readonly name = 'SetOutbound';
  private content: string;

  constructor(content: string) {
    this.content = content;
  }

  async execute(state: PipelineState, next: NextFn): Promise<PipelineState> {
    state.outbound = { content: this.content };
    return next(state);
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('Pipeline', () => {
  let pipeline: Pipeline;

  beforeEach(() => {
    pipeline = new Pipeline();
  });

  // ─── Lifecycle ──────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should initialize with dependencies', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);
      // No error means success
    });

    it('should not re-initialize if already initialized', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);
      // Second call should not throw
      pipeline.initialize(deps);
    });

    it('should destroy and clear state', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);
      pipeline.destroy();
      // Pipeline should not process messages after destroy
    });
  });

  // ─── receiveWithSend ────────────────────────────────────────────

  describe('receiveWithSend', () => {
    it('should not process if not initialized', async () => {
      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });

      // Pipeline not initialized — should not throw, just return
      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).not.toHaveBeenCalled();
    });

    it('should call send with outbound from middleware chain', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);
      pipeline.use(new SetOutboundMiddleware('test response'));

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });

      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(sent[0].content).toBe('test response');
    });

    it('should pass an onSend-aware callback into agent processing', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);

      const send = vi.fn(async (_msg: OutboundMessage) => undefined);
      await pipeline.receiveWithSend(makeInbound(), send);

      const processMock = deps.agentEngine.process as ReturnType<typeof vi.fn>;
      expect(processMock).toHaveBeenCalled();
      expect(processMock.mock.calls[0]?.[4]).toEqual(expect.any(Function));
    });
  });

  // ─── Middleware chain order ──────────────────────────────────────

  describe('middleware chain order', () => {
    it('should execute middlewares in registration order', async () => {
      const deps = await createPipelineDeps();
      const customPipeline = new Pipeline();
      const order: string[] = [];
      const m1 = new RecordingMiddleware('m1', order);
      const m2 = new RecordingMiddleware('m2', order);
      const m3 = new RecordingMiddleware('m3', order);

      customPipeline.initialize(deps);
      customPipeline.use(m1);
      customPipeline.use(m2);
      customPipeline.use(m3);

      const send = vi.fn();
      await customPipeline.receiveWithSend(makeInbound(), send);

      expect(order).toEqual(['m1', 'm2', 'm3']);
    });
  });

  // ─── Command detection ──────────────────────────────────────────

  describe('command detection', () => {
    it('should execute a command and not call agent processor', async () => {
      const deps = await createPipelineDeps();

      // Register a command
      deps.commandRegistry.register({
        name: 'greet',
        description: 'Greet the user',
        scope: 'system',
        execute: async () => 'Hello from command!',
      });

      pipeline.initialize(deps);

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });

      await pipeline.receiveWithSend(makeInbound('/greet'), send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(sent[0].content).toBe('Hello from command!');
    });

    it('should not detect commands for regular messages', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound('just chatting'), send);
      // AgentProcessor stub produces an outbound, so send should be called
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Hook integration ──────────────────────────────────────────

  describe('hook integration', () => {
    it('should block message on onReceive hook', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);

      // Register a blocking hook
      const hooks: PluginHooks = {
        onReceive: async () => ({ action: 'block' as const, reason: 'forbidden' }),
      };
      pipeline.getHookDispatcher().register('blocker', hooks);

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).not.toHaveBeenCalled();
    });

    it('should send direct response on onReceive respond hook', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);

      const hooks: PluginHooks = {
        onReceive: async () => ({ action: 'respond' as const, content: 'direct hook reply' }),
      };
      pipeline.getHookDispatcher().register('responder', hooks);

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });

      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(sent[0].content).toBe('direct hook reply');
    });

    it('should block outbound on onSend hook', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);

      const hooks: PluginHooks = {
        onSend: async () => ({ action: 'block' as const, reason: 'output filtered' }),
      };
      pipeline.getHookDispatcher().register('filter', hooks);

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).not.toHaveBeenCalled();
    });

    it('should modify outbound on onSend respond hook', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);

      const hooks: PluginHooks = {
        onSend: async () => ({ action: 'respond' as const, content: 'modified output' }),
      };
      pipeline.getHookDispatcher().register('modifier', hooks);

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });

      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(sent[0].content).toBe('modified output');
    });

    it('should block live agent processing on beforeLLMRequest hook', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);

      const processMock = deps.agentEngine.process as ReturnType<typeof vi.fn>;
      pipeline.getHookDispatcher().register('llm-blocker', {
        beforeLLMRequest: async () => ({ action: 'block' as const, reason: 'rate limited' }),
      });

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound(), send);

      expect(processMock).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('should return hook responses from beforeLLMRequest without calling the agent', async () => {
      const deps = await createPipelineDeps();
      pipeline.initialize(deps);

      const processMock = deps.agentEngine.process as ReturnType<typeof vi.fn>;
      pipeline.getHookDispatcher().register('llm-responder', {
        beforeLLMRequest: async () => ({ action: 'respond' as const, content: 'cached answer' }),
      });

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });
      await pipeline.receiveWithSend(makeInbound(), send);

      expect(processMock).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
      expect(sent[0].content).toBe('cached answer');
    });
  });

  // ─── Middleware error handling ──────────────────────────────────

  describe('middleware error handling', () => {
    it('should mark state as blocked when a middleware throws', async () => {
      const deps = await createPipelineDeps();

      const customPipeline = new Pipeline();
      customPipeline.initialize(deps);

      // Add a middleware that throws
      class ThrowingMiddleware implements Middleware {
        readonly name = 'Throwing';
        async execute(_state: PipelineState, _next: NextFn): Promise<PipelineState> {
          throw new Error('middleware crashed');
        }
      }
      customPipeline.use(new ThrowingMiddleware());

      const send = vi.fn();
      await customPipeline.receiveWithSend(makeInbound(), send);
      // Pipeline should handle the error gracefully — no send
      expect(send).not.toHaveBeenCalled();
    });
  });
});
