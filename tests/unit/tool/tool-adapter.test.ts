/**
 * ToolAdapter unit tests.
 *
 * Tests cover: hook integration (before/after), short-circuit,
 * abort signal, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { ToolAdapter } from '../../../src/tool/tool-adapter';
import type { AesyClawTool, ToolExecutionContext } from '../../../src/tool/tool-registry';
import type { HookDispatcher } from '../../../src/pipeline/hook-dispatcher';
import { Type } from '@sinclair/typebox';

// ─── Helpers ──────────────────────────────────────────────────────

function makeTool(overrides: Partial<AesyClawTool> = {}): AesyClawTool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    parameters: Type.Object({ input: Type.String() }),
    owner: 'system',
    execute: async () => ({ content: 'test result' }),
    ...overrides,
  };
}

function makeNoOpHookDispatcher(): HookDispatcher {
  return {
    async dispatchBeforeToolCall() {
      return {};
    },
    async dispatchAfterToolCall() {
      return {};
    },
  };
}

function makeBlockingHookDispatcher(reason: string): HookDispatcher {
  return {
    async dispatchBeforeToolCall() {
      return { block: true, reason };
    },
    async dispatchAfterToolCall() {
      return {};
    },
  };
}

function makeShortCircuitHookDispatcher(result: {
  content: string;
  isError?: boolean;
}): HookDispatcher {
  return {
    async dispatchBeforeToolCall() {
      return {
        shortCircuit: {
          content: result.content,
          isError: result.isError,
        },
      };
    },
    async dispatchAfterToolCall() {
      return {};
    },
  };
}

function makeOverrideHookDispatcher(override: {
  content?: string;
  isError?: boolean;
}): HookDispatcher {
  return {
    async dispatchBeforeToolCall() {
      return {};
    },
    async dispatchAfterToolCall() {
      return { override };
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('ToolAdapter', () => {
  describe('toAgentTool', () => {
    it('should convert AesyClawTool to AgentTool with correct properties', () => {
      const tool = makeTool();
      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});

      expect(agentTool.name).toBe('test-tool');
      expect(agentTool.label).toBe('test-tool');
      expect(agentTool.description).toBe('A test tool');
      expect(typeof agentTool.execute).toBe('function');
    });

    it('should execute the tool and return the result', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'Hello from tool' }),
      });

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});
      const result = await agentTool.execute('call-1', { input: 'test' });

      expect(result.content).toEqual([{ type: 'text', text: 'Hello from tool' }]);
    });

    it('should pass through execution context', async () => {
      let receivedContext: unknown = null;
      const tool = makeTool({
        execute: async (_params, context) => {
          receivedContext = context;
          return { content: 'ok' };
        },
      });

      const context: Partial<ToolExecutionContext> = {
        sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
      };

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), context);
      await agentTool.execute('call-1', {});

      expect(receivedContext).toEqual(context);
    });

    it('should block execution when before hook blocks', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'should not run' }),
      });

      const agentTool = ToolAdapter.toAgentTool(
        tool,
        makeBlockingHookDispatcher('Blocked by policy'),
        {},
      );

      await expect(agentTool.execute('call-1', {})).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Blocked by policy' }],
        details: {},
        isError: true,
      });
    });

    it('should short-circuit when before hook provides result', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'should not run' }),
      });

      const agentTool = ToolAdapter.toAgentTool(
        tool,
        makeShortCircuitHookDispatcher({ content: 'Short-circuited', isError: false }),
        {},
      );
      const result = await agentTool.execute('call-1', {});

      expect(result.content).toEqual([{ type: 'text', text: 'Short-circuited' }]);
    });

    it('should preserve short-circuit error results as structured failures', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'should not run' }),
      });

      const agentTool = ToolAdapter.toAgentTool(
        tool,
        makeShortCircuitHookDispatcher({ content: 'Cached failure', isError: true }),
        {},
      );

      await expect(agentTool.execute('call-1', {})).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Cached failure' }],
        details: {},
        isError: true,
      });
    });

    it('should allow after hook to override result', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'original result' }),
      });

      const agentTool = ToolAdapter.toAgentTool(
        tool,
        makeOverrideHookDispatcher({ content: 'overridden result' }),
        {},
      );
      const result = await agentTool.execute('call-1', {});

      expect(result.content).toEqual([{ type: 'text', text: 'overridden result' }]);
    });

    it('should preserve tool error results as structured failures', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'Tool failed', isError: true }),
      });

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});

      await expect(agentTool.execute('call-1', {})).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Tool failed' }],
        details: {},
        isError: true,
      });
    });

    it('should respect after hook isError overrides', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'original result' }),
      });

      const agentTool = ToolAdapter.toAgentTool(
        tool,
        makeOverrideHookDispatcher({ content: 'overridden failure', isError: true }),
        {},
      );

      await expect(agentTool.execute('call-1', {})).resolves.toMatchObject({
        content: [{ type: 'text', text: 'overridden failure' }],
        details: {},
        isError: true,
      });
    });

    it('should catch thrown errors from tool execute and return structured failures', async () => {
      const tool = makeTool({
        execute: async () => {
          throw new Error('Tool crashed');
        },
      });

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});
      await expect(agentTool.execute('call-1', {})).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Tool crashed' }],
        details: {},
        isError: true,
      });
    });

    it('should return structured aborted results when signal is already aborted', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'should not run' }),
      });

      const controller = new AbortController();
      controller.abort();

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});
      await expect(agentTool.execute('call-1', {}, controller.signal)).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Tool call "test-tool" was aborted' }],
        details: {},
        isError: true,
      });
    });

    it('should use default sessionKey when not provided in context', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'ok' }),
      });

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});
      // Should not throw — just uses empty sessionKey
      const result = await agentTool.execute('call-1', {});
      expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    });
  });
});
