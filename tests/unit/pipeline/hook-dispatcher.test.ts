/**
 * HookDispatcher unit tests.
 *
 * Tests cover: register/unregister, onReceive dispatch (continue, block, respond),
 * onSend dispatch, beforeToolCall, afterToolCall, beforeLLM,
 * error handling in hooks, and duplicate registration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HookDispatcher } from '../../../src/pipeline/hook-dispatcher';
import type { PluginHooks, PipeCtx, SendCtx } from '../../../src/pipeline/types';
import type { Message, PipelineResult } from '../../../src/core/types';
import type {
  BeforeToolCallHookContext,
  AfterToolCallHookContext,
} from '../../../src/agent/agent-types';

// ─── Helpers ──────────────────────────────────────────────────────

function makeInbound(content = 'hello'): Message {
  return {
    components: [{ type: 'Plain', text: content }],
  };
}

function dispatchOnReceive(
  dispatcher: HookDispatcher,
  message = makeInbound(),
): Promise<PipelineResult> {
  return dispatcher.onReceive({
    message,
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
  });
}

function makeOutbound(content = 'reply'): Message {
  return { components: [{ type: 'Plain', text: content }] };
}

function makeSendCtx(): SendCtx {
  return {
    message: makeOutbound(),
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
  };
}

function makeBeforeToolCallContext(toolName = 'testTool'): BeforeToolCallHookContext {
  return {
    toolName,
    params: {},
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
  };
}

function makeAfterToolCallContext(toolName = 'testTool'): AfterToolCallHookContext {
  return {
    toolName,
    params: {},
    result: { content: 'tool result' },
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
  };
}

function makeLLMPipeCtx(): PipeCtx {
  return {
    message: makeInbound(),
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
    session: undefined,
    agent: undefined,
    role: undefined,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('HookDispatcher', () => {
  let dispatcher: HookDispatcher;

  beforeEach(() => {
    dispatcher = new HookDispatcher();
  });

  // ─── register / unregister ──────────────────────────────────────

  describe('register', () => {
    it('should register a plugin with hooks', () => {
      const hooks: PluginHooks = {
        onReceive: async () => ({ action: 'continue' as const }),
      };
      dispatcher.register('test-plugin', hooks);
      // Verify by dispatching — if registered, it should be called
      // (indirect test via dispatch below)
    });

    it('should replace hooks if plugin is registered again', async () => {
      const hooks1: PluginHooks = {
        onReceive: async () => ({ action: 'block' as const, reason: 'first' }),
      };
      const hooks2: PluginHooks = {
        onReceive: async () => ({ action: 'block' as const, reason: 'second' }),
      };
      dispatcher.register('test-plugin', hooks1);
      dispatcher.register('test-plugin', hooks2);

      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('block');
      if (result.action === 'block') {
        expect(result.reason).toBe('second');
      }
    });
  });

  describe('unregister', () => {
    it('should remove a plugin hooks', async () => {
      const hooks: PluginHooks = {
        onReceive: async () => ({ action: 'block' as const, reason: 'blocked' }),
      };
      dispatcher.register('test-plugin', hooks);
      dispatcher.unregister('test-plugin');

      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('continue');
    });

    it('should be a no-op if plugin not registered', () => {
      expect(() => dispatcher.unregister('nonexistent')).not.toThrow();
    });
  });

  // ─── onReceive ──────────────────────────────────────────────────

  describe('onReceive', () => {
    it('should return continue when no hooks are registered', async () => {
      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('continue');
    });

    it('should return continue when hooks return continue', async () => {
      dispatcher.register('p1', {
        onReceive: async () => ({ action: 'continue' as const }),
      });
      dispatcher.register('p2', {
        onReceive: async () => ({ action: 'continue' as const }),
      });

      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('continue');
    });

    it('should return block when a hook blocks', async () => {
      dispatcher.register('p1', {
        onReceive: async () => ({ action: 'block' as const, reason: 'not allowed' }),
      });

      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('block');
      if (result.action === 'block') {
        expect(result.reason).toBe('not allowed');
      }
    });

    it('should stop dispatching after a hook blocks', async () => {
      let secondHookCalled = false;
      dispatcher.register('p1', {
        onReceive: async () => ({ action: 'block' as const, reason: 'stop' }),
      });
      dispatcher.register('p2', {
        onReceive: async () => {
          secondHookCalled = true;
          return { action: 'continue' as const };
        },
      });

      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('block');
      expect(secondHookCalled).toBe(false);
    });

    it('should return respond when a hook responds', async () => {
      dispatcher.register('p1', {
        onReceive: async () => ({
          action: 'respond' as const,
          components: [{ type: 'Plain', text: 'direct reply' }],
        }),
      });

      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('respond');
      if (result.action === 'respond') {
        expect(result.components[0].text).toBe('direct reply');
      }
    });

    it('should stop dispatching after a hook responds', async () => {
      let secondHookCalled = false;
      dispatcher.register('p1', {
        onReceive: async () => ({
          action: 'respond' as const,
          components: [{ type: 'Plain', text: 'reply' }],
        }),
      });
      dispatcher.register('p2', {
        onReceive: async () => {
          secondHookCalled = true;
          return { action: 'continue' as const };
        },
      });

      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('respond');
      expect(secondHookCalled).toBe(false);
    });

    it('should skip hooks that throw errors and continue', async () => {
      dispatcher.register('p1', {
        onReceive: async () => {
          throw new Error('hook error');
        },
      });
      dispatcher.register('p2', {
        onReceive: async () => ({ action: 'block' as const, reason: 'p2 blocked' }),
      });

      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('block');
    });

    it('should skip hooks without onReceive', async () => {
      dispatcher.register('p1', {
        onSend: async () => ({ action: 'continue' as const }),
      });

      const result = await dispatchOnReceive(dispatcher);
      expect(result.action).toBe('continue');
    });
  });

  // ─── onSend ─────────────────────────────────────────────────────

  describe('onSend', () => {
    it('should return continue when no hooks are registered', async () => {
      const result = await dispatcher.onSend(makeSendCtx());
      expect(result.action).toBe('continue');
    });

    it('should return block when a hook blocks', async () => {
      dispatcher.register('p1', {
        onSend: async () => ({ action: 'block' as const, reason: 'censored' }),
      });

      const result = await dispatcher.onSend(makeSendCtx());
      expect(result.action).toBe('block');
      if (result.action === 'block') {
        expect(result.reason).toBe('censored');
      }
    });

    it('should return respond when a hook responds', async () => {
      dispatcher.register('p1', {
        onSend: async () => ({
          action: 'respond' as const,
          components: [{ type: 'Plain', text: 'modified' }],
        }),
      });

      const result = await dispatcher.onSend(makeSendCtx());
      expect(result.action).toBe('respond');
      if (result.action === 'respond') {
        expect(result.components[0].text).toBe('modified');
      }
    });

    it('should skip hooks without onSend', async () => {
      dispatcher.register('p1', {
        onReceive: async () => ({ action: 'continue' as const }),
      });

      const result = await dispatcher.onSend(makeSendCtx());
      expect(result.action).toBe('continue');
    });
  });

  // ─── beforeToolCall ─────────────────────────────────────────────

  describe('beforeToolCall', () => {
    it('should return empty result when no hooks are registered', async () => {
      const result = await dispatcher.beforeToolCall(makeBeforeToolCallContext());
      expect(result.block).toBeUndefined();
    });

    it('should return block when a hook blocks', async () => {
      dispatcher.register('p1', {
        beforeToolCall: async () => ({ block: true, reason: 'not allowed' }),
      });

      const result = await dispatcher.beforeToolCall(makeBeforeToolCallContext());
      expect(result.block).toBe(true);
      expect(result.reason).toBe('not allowed');
    });

    it('should stop dispatching after a hook blocks', async () => {
      let secondHookCalled = false;
      dispatcher.register('p1', {
        beforeToolCall: async () => ({ block: true, reason: 'stop' }),
      });
      dispatcher.register('p2', {
        beforeToolCall: async () => {
          secondHookCalled = true;
          return {};
        },
      });

      await dispatcher.beforeToolCall(makeBeforeToolCallContext());
      expect(secondHookCalled).toBe(false);
    });

    it('should skip hooks without beforeToolCall', async () => {
      dispatcher.register('p1', {
        onReceive: async () => ({ action: 'continue' as const }),
      });

      const result = await dispatcher.beforeToolCall(makeBeforeToolCallContext());
      expect(result.block).toBeUndefined();
    });
  });

  // ─── afterToolCall ──────────────────────────────────────────────

  describe('afterToolCall', () => {
    it('should return empty result when no hooks are registered', async () => {
      const result = await dispatcher.afterToolCall(makeAfterToolCallContext());
      expect(result.override).toBeUndefined();
    });

    it('should return override when a hook overrides', async () => {
      dispatcher.register('p1', {
        afterToolCall: async () => ({
          override: { content: 'overridden' },
        }),
      });

      const result = await dispatcher.afterToolCall(makeAfterToolCallContext());
      expect(result.override).toEqual({ content: 'overridden' });
    });

    it('should stop dispatching after a hook overrides', async () => {
      let secondHookCalled = false;
      dispatcher.register('p1', {
        afterToolCall: async () => ({
          override: { content: 'first override' },
        }),
      });
      dispatcher.register('p2', {
        afterToolCall: async () => {
          secondHookCalled = true;
          return { override: { content: 'second override' } };
        },
      });

      const result = await dispatcher.afterToolCall(makeAfterToolCallContext());
      expect(result.override).toEqual({ content: 'first override' });
      expect(secondHookCalled).toBe(false);
    });
  });

  // ─── beforeLLM ──────────────────────────────────────────────────

  describe('beforeLLM', () => {
    it('should return continue when no hooks are registered', async () => {
      const result = await dispatcher.beforeLLM(makeLLMPipeCtx());
      expect(result.action).toBe('continue');
    });

    it('should return block when a hook blocks', async () => {
      dispatcher.register('p1', {
        beforeLLM: async () => ({ action: 'block' as const, reason: 'rate limited' }),
      });

      const result = await dispatcher.beforeLLM(makeLLMPipeCtx());
      expect(result.action).toBe('block');
      if (result.action === 'block') {
        expect(result.reason).toBe('rate limited');
      }
    });

    it('should return respond when a hook responds', async () => {
      dispatcher.register('p1', {
        beforeLLM: async () => ({
          action: 'respond' as const,
          components: [{ type: 'Plain', text: 'cached' }],
        }),
      });

      const result = await dispatcher.beforeLLM(makeLLMPipeCtx());
      expect(result.action).toBe('respond');
      if (result.action === 'respond') {
        expect(result.components[0].text).toBe('cached');
      }
    });
  });

  // ─── Hook call order ────────────────────────────────────────────

  describe('call order', () => {
    it('should call hooks in registration order', async () => {
      const order: string[] = [];
      dispatcher.register('p1', {
        onReceive: async () => {
          order.push('p1');
          return { action: 'continue' as const };
        },
      });
      dispatcher.register('p2', {
        onReceive: async () => {
          order.push('p2');
          return { action: 'continue' as const };
        },
      });
      dispatcher.register('p3', {
        onReceive: async () => {
          order.push('p3');
          return { action: 'continue' as const };
        },
      });

      await dispatchOnReceive(dispatcher);
      expect(order).toEqual(['p1', 'p2', 'p3']);
    });
  });
});
