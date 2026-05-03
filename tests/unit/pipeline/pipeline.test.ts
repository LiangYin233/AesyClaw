/**
 * Pipeline unit tests.
 *
 * Tests cover: receiveWithSend flow, command detection shortcut,
 * hook blocking, hook respond, and agent processing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Pipeline } from '../../../src/pipeline/pipeline';
import type { InboundMessage, OutboundMessage } from '../../../src/core/types';
import { getOutboundMessageText } from '../../../src/core/types';
import type { PluginHooks } from '../../../src/pipeline/middleware/types';
import { CommandRegistry } from '../../../src/command/command-registry';
import type { SessionManager } from '../../../src/agent/session-manager';
import type { AgentEngine } from '../../../src/agent/agent-engine';

// ─── Helpers ──────────────────────────────────────────────────────

function makeInbound(content = 'hello'): InboundMessage {
  return {
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
    components: [{ type: 'Plain', text: content }],
  };
}

function makeInboundForKey(
  sessionKey: InboundMessage['sessionKey'],
  content = 'hello',
): InboundMessage {
  return { sessionKey, components: [{ type: 'Plain', text: content }] };
}

/** Create pipeline deps with real CommandRegistry */
async function createPipelineDeps() {
  // Mock SessionManager that returns a minimal session context
  let processingSimulated = false;
  const mockSessionManager = {
    getOrCreateSession: vi
      .fn()
      .mockImplementation(async (sessionKey: InboundMessage['sessionKey']) => ({
        key: sessionKey,
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
      })),
    getSession: vi.fn().mockReturnValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
    compactSession: vi.fn().mockResolvedValue(''),
    switchRole: vi.fn().mockResolvedValue(undefined),
    isAgentProcessing: vi.fn().mockImplementation(() => processingSimulated),
    tryBeginAgentProcessing: vi.fn().mockImplementation(() => {
      if (processingSimulated) return false;
      processingSimulated = true;
      return true;
    }),
    endAgentProcessing: vi.fn().mockImplementation(() => {
      processingSimulated = false;
    }),
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
          apiType: 'openai_responses',
        },
        tools: [],
        messages: [],
      },
      prompt: vi.fn(),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    }),
    process: vi.fn().mockResolvedValue({ components: [{ type: 'Plain', text: 'Agent response' }] }),
    switchModel: vi.fn(),
  } as unknown as AgentEngine;

  return {
    sessionManager: mockSessionManager,
    agentEngine: mockAgentEngine,
    commandRegistry: new CommandRegistry(),
  };
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
      await pipeline.initialize(deps);
      // No error means success
    });

    it('should not re-initialize if already initialized', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);
      // Second call should not throw
      await pipeline.initialize(deps);
    });

    it('should destroy and clear state', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);
      pipeline.destroy();
      // Pipeline should not process messages after destroy
    });

    it('should clear hook registrations on destroy', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);
      pipeline.register('blocker', {
        onReceive: async () => ({ action: 'block' as const, reason: 'stale hook' }),
      });
      pipeline.destroy();

      await pipeline.initialize(deps);

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound(), send);

      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  // ─── receiveWithSend ────────────────────────────────────────────

  describe('receiveWithSend', () => {
    it('should not process if not initialized', async () => {
      const send = vi.fn();

      // Pipeline not initialized — should throw
      await expect(pipeline.receiveWithSend(makeInbound(), send)).rejects.toThrow(/未初始化/);
      expect(send).not.toHaveBeenCalled();
    });

    it('should call send with outbound from agent processing', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });

      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(getOutboundMessageText(sent[0])).toBe('Agent response');
    });

    it('should pass an onSend-aware callback into agent processing', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      const send = vi.fn(async (_msg: OutboundMessage) => undefined);
      await pipeline.receiveWithSend(makeInbound(), send);

      const processMock = deps.agentEngine.process as ReturnType<typeof vi.fn>;
      expect(processMock).toHaveBeenCalled();
      expect(processMock.mock.calls[0]?.[4]).toEqual(expect.any(Function));
    });

    it('should propagate processing errors after logging them', async () => {
      const deps = await createPipelineDeps();
      const processMock = deps.agentEngine.process as ReturnType<typeof vi.fn>;
      processMock.mockRejectedValue(new Error('agent boom'));
      await pipeline.initialize(deps);

      await expect(pipeline.receiveWithSend(makeInbound(), vi.fn())).rejects.toThrow('agent boom');
    });

    it('should return busy for a concurrent ordinary message in the same session', async () => {
      const deps = await createPipelineDeps();
      const busyKeys = new Set<string>();
      const keyOf = (key: InboundMessage['sessionKey']) =>
        JSON.stringify({ channel: key.channel, type: key.type, chatId: key.chatId });
      (deps.sessionManager.isAgentProcessing as ReturnType<typeof vi.fn>).mockImplementation(
        (key: InboundMessage['sessionKey']) => busyKeys.has(keyOf(key)),
      );
      (deps.sessionManager.tryBeginAgentProcessing as ReturnType<typeof vi.fn>).mockImplementation(
        (key: InboundMessage['sessionKey']) => {
          const cacheKey = keyOf(key);
          if (busyKeys.has(cacheKey)) return false;
          busyKeys.add(cacheKey);
          return true;
        },
      );
      (deps.sessionManager.endAgentProcessing as ReturnType<typeof vi.fn>).mockImplementation(
        (key: InboundMessage['sessionKey']) => {
          busyKeys.delete(keyOf(key));
        },
      );

      let releaseProcess: (() => void) | undefined;
      (deps.agentEngine.process as ReturnType<typeof vi.fn>).mockImplementation(
        async () =>
          await new Promise((resolve) => {
            releaseProcess = () => resolve({ components: [{ type: 'Plain', text: 'Agent response' }] });
          }),
      );
      await pipeline.initialize(deps);

      const firstSend = vi.fn();
      const secondSend = vi.fn();
      const first = pipeline.receiveWithSend(makeInbound('first'), firstSend);
      await vi.waitFor(() => expect(deps.agentEngine.process).toHaveBeenCalledTimes(1));

      await pipeline.receiveWithSend(makeInbound('second'), secondSend);

      expect(deps.agentEngine.process).toHaveBeenCalledTimes(1);
      expect(secondSend).toHaveBeenCalledWith({ components: [{ type: 'Plain', text: 'Agent处理任务中。' }] });

      releaseProcess?.();
      await first;
      expect(firstSend).toHaveBeenCalledWith({ components: [{ type: 'Plain', text: 'Agent response' }] });
    });

    it('should allow later ordinary processing after the busy lock is released', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound('first'), send);
      await pipeline.receiveWithSend(makeInbound('second'), send);

      expect(deps.agentEngine.process).toHaveBeenCalledTimes(2);
      expect(deps.sessionManager.endAgentProcessing).toHaveBeenCalledTimes(2);
    });

    it('should not block different session keys while one session is busy', async () => {
      const deps = await createPipelineDeps();
      const busyKeyJson = JSON.stringify({ channel: 'test', type: 'private', chatId: 'user1' });
      const processingKeys = new Set<string>();

      (deps.sessionManager.isAgentProcessing as ReturnType<typeof vi.fn>).mockImplementation(
        (key: InboundMessage['sessionKey']) => {
          const k = JSON.stringify({ channel: key.channel, type: key.type, chatId: key.chatId });
          return k === busyKeyJson || processingKeys.has(k);
        },
      );
      (deps.sessionManager.tryBeginAgentProcessing as ReturnType<typeof vi.fn>).mockImplementation(
        (key: InboundMessage['sessionKey']) => {
          const k = JSON.stringify({ channel: key.channel, type: key.type, chatId: key.chatId });
          if (k === busyKeyJson) return false;
          if (processingKeys.has(k)) return false;
          processingKeys.add(k);
          return true;
        },
      );
      (deps.sessionManager.endAgentProcessing as ReturnType<typeof vi.fn>).mockImplementation(
        (key: InboundMessage['sessionKey']) => {
          processingKeys.delete(
            JSON.stringify({ channel: key.channel, type: key.type, chatId: key.chatId }),
          );
        },
      );
      await pipeline.initialize(deps);

      const differentChatSend = vi.fn();
      const differentChannelSend = vi.fn();
      const cronSend = vi.fn();
      await pipeline.receiveWithSend(
        makeInboundForKey({ channel: 'test', type: 'private', chatId: 'user2' }),
        differentChatSend,
      );
      await pipeline.receiveWithSend(
        makeInboundForKey({ channel: 'other', type: 'private', chatId: 'user1' }),
        differentChannelSend,
      );
      await pipeline.receiveWithSend(
        makeInboundForKey({ channel: 'cron', type: 'job', chatId: 'job1' }),
        cronSend,
      );

      expect(deps.agentEngine.process).toHaveBeenCalledTimes(3);
      expect(differentChatSend).toHaveBeenCalledWith({ components: [{ type: 'Plain', text: 'Agent response' }] });
      expect(differentChannelSend).toHaveBeenCalledWith({ components: [{ type: 'Plain', text: 'Agent response' }] });
      expect(cronSend).toHaveBeenCalledWith({ components: [{ type: 'Plain', text: 'Agent response' }] });
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

      await pipeline.initialize(deps);

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });

      await pipeline.receiveWithSend(makeInbound('/greet'), send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(getOutboundMessageText(sent[0])).toBe('Hello from command!');
    });

    it('should not detect commands for regular messages', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound('just chatting'), send);
      // Agent processor produces an outbound, so send should be called
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Hook integration ──────────────────────────────────────────

  describe('hook integration', () => {
    it('should block message on onReceive hook', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      // Register a blocking hook
      const hooks: PluginHooks = {
        onReceive: async () => ({ action: 'block' as const, reason: 'forbidden' }),
      };
      pipeline.register('blocker', hooks);

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).not.toHaveBeenCalled();
    });

    it('should send direct response on onReceive respond hook', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      const hooks: PluginHooks = {
        onReceive: async () => ({ action: 'respond' as const, components: [{ type: 'Plain', text: 'direct hook reply' }] }),
      };
      pipeline.register('responder', hooks);

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });

      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(getOutboundMessageText(sent[0])).toBe('direct hook reply');
    });

    it('should block outbound on onSend hook', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      const hooks: PluginHooks = {
        onSend: async () => ({ action: 'block' as const, reason: 'output filtered' }),
      };
      pipeline.register('filter', hooks);

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).not.toHaveBeenCalled();
    });

    it('should modify outbound on onSend respond hook', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      const hooks: PluginHooks = {
        onSend: async () => ({ action: 'respond' as const, components: [{ type: 'Plain', text: 'modified output' }] }),
      };
      pipeline.register('modifier', hooks);

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });

      await pipeline.receiveWithSend(makeInbound(), send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(getOutboundMessageText(sent[0])).toBe('modified output');
    });

    it('should block live agent processing on beforeLLMRequest hook', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      const processMock = deps.agentEngine.process as ReturnType<typeof vi.fn>;
      pipeline.register('llm-blocker', {
        beforeLLMRequest: async () => ({ action: 'block' as const, reason: 'rate limited' }),
      });

      const send = vi.fn();
      await pipeline.receiveWithSend(makeInbound(), send);

      expect(processMock).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('should return hook responses from beforeLLMRequest without calling the agent', async () => {
      const deps = await createPipelineDeps();
      await pipeline.initialize(deps);

      const processMock = deps.agentEngine.process as ReturnType<typeof vi.fn>;
      pipeline.register('llm-responder', {
        beforeLLMRequest: async () => ({ action: 'respond' as const, components: [{ type: 'Plain', text: 'cached answer' }] }),
      });

      const sent: OutboundMessage[] = [];
      const send = vi.fn(async (msg: OutboundMessage) => {
        sent.push(msg);
      });
      await pipeline.receiveWithSend(makeInbound(), send);

      expect(processMock).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
      expect(getOutboundMessageText(sent[0])).toBe('cached answer');
    });
  });
});
