/**
 * ToolAdapter unit tests.
 *
 * Tests cover: hook integration (before/after), short-circuit,
 * abort signal, and error handling.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ToolAdapter } from '../../../src/tool/tool-adapter';
import type { AesyClawTool, ToolExecutionContext } from '../../../src/tool/tool-registry';
import type { HookDispatcher } from '../../../src/pipeline/hook-dispatcher';
import { setLogLevel } from '../../../src/core/logger';
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
  } as unknown as HookDispatcher;
}

function makeBlockingHookDispatcher(reason: string): HookDispatcher {
  return {
    async dispatchBeforeToolCall() {
      return { block: true, reason };
    },
    async dispatchAfterToolCall() {
      return {};
    },
  } as unknown as HookDispatcher;
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
  } as unknown as HookDispatcher;
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
  } as unknown as HookDispatcher;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('ToolAdapter', () => {
  beforeEach(() => {
    setLogLevel('debug');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel('info');
  });

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
      await agentTool.execute('call-1', { input: 'test' });

      expect(receivedContext).toEqual(context);
    });

    it('should pass invalid system-tool parameters through to the tool implementation', async () => {
      let receivedParams: unknown = null;
      const tool = makeTool({
        execute: async (params) => {
          receivedParams = params;
          return { content: 'system saw invalid params', isError: true };
        },
      });

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});
      const params = {};

      await expect(agentTool.execute('call-1', params)).resolves.toMatchObject({
        content: [
          {
            type: 'text',
            text: 'system saw invalid params',
          },
        ],
        isError: true,
      });
      expect(receivedParams).toBe(params);
    });

    it('should pass invalid MCP-tool parameters through without local validation', async () => {
      let receivedParams: unknown = null;
      const externalJsonSchema = Type.Unsafe({
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      });
      const tool = makeTool({
        name: 'WebSearch_tavily_search',
        parameters: externalJsonSchema,
        owner: 'mcp:WebSearch',
        execute: async (params) => {
          receivedParams = params;
          return { content: 'mcp result' };
        },
      });

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});
      const params = { max_results: 'not-a-number' };
      const result = await agentTool.execute('call-mcp', params);

      expect(receivedParams).toBe(params);
      expect(result).toMatchObject({
        content: [{ type: 'text', text: 'mcp result' }],
        details: {},
        isError: undefined,
      });
    });

    it('should pass invalid plugin-tool parameters through to the tool implementation', async () => {
      let receivedParams: unknown = null;
      const tool = makeTool({
        owner: 'plugin:weather',
        execute: async (params) => {
          receivedParams = params;
          return { content: 'plugin saw invalid params', isError: true };
        },
      });

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});
      const params = {};

      await expect(agentTool.execute('call-plugin-invalid', params)).resolves.toMatchObject({
        content: [
          {
            type: 'text',
            text: 'plugin saw invalid params',
          },
        ],
        isError: true,
      });
      expect(receivedParams).toBe(params);
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
      const result = await agentTool.execute('call-1', { input: 'test' });

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

      await expect(agentTool.execute('call-1', { input: 'test' })).resolves.toMatchObject({
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
      const result = await agentTool.execute('call-1', { input: 'test' });

      expect(result.content).toEqual([{ type: 'text', text: 'overridden result' }]);
    });

    it('should preserve tool error results as structured failures', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'Tool failed', isError: true }),
      });

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});

      await expect(agentTool.execute('call-1', { input: 'test' })).resolves.toMatchObject({
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

      await expect(agentTool.execute('call-1', { input: 'test' })).resolves.toMatchObject({
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
      await expect(agentTool.execute('call-1', { input: 'test' })).resolves.toMatchObject({
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
        content: [{ type: 'text', text: '工具调用 "test-tool" 被中止' }],
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
      const result = await agentTool.execute('call-1', { input: 'test' });
      expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    });

    it('should debug-log invocation and completion with actual parameter values', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'secret tool result', details: { recordCount: 1 } }),
      });

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});
      await agentTool.execute('call-logging', { input: 'secret user payload' });

      expectDebugLog('工具调用已触发', {
        toolName: 'test-tool',
        toolCallId: 'call-logging',
        owner: 'system',
        params: { input: 'secret user payload' },
      });
      expectDebugLog('工具调用完成', {
        toolName: 'test-tool',
        toolCallId: 'call-logging',
        outcome: 'executed',
        result: {
          contentLength: 'secret tool result'.length,
          hasDetails: true,
          isError: false,
          terminate: false,
        },
      });
    });

    it('should debug-log before-hook block and short-circuit paths', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'should not run' }),
      });
      const blockedTool = ToolAdapter.toAgentTool(
        tool,
        makeBlockingHookDispatcher('Blocked by policy'),
        {},
      );
      const shortCircuitTool = ToolAdapter.toAgentTool(
        tool,
        makeShortCircuitHookDispatcher({ content: 'Cached result' }),
        {},
      );

      await blockedTool.execute('call-blocked', { input: 'test' });
      await shortCircuitTool.execute('call-short', { input: 'test' });

      expectDebugLog('工具调用被 before 钩子阻塞', {
        toolName: 'test-tool',
        toolCallId: 'call-blocked',
        hasReason: true,
      });
      expectDebugLog('工具调用完成', {
        toolName: 'test-tool',
        toolCallId: 'call-blocked',
        outcome: 'blocked',
      });
      expectDebugLog('工具调用被 before 钩子短路', {
        toolName: 'test-tool',
        toolCallId: 'call-short',
        result: {
          contentLength: 'Cached result'.length,
          hasDetails: false,
          isError: false,
          terminate: false,
        },
      });
      expectDebugLog('工具调用完成', {
        toolName: 'test-tool',
        toolCallId: 'call-short',
        outcome: 'short-circuited',
      });
    });

    it('should debug-log execution failures from downstream tool implementations', async () => {
      const failingTool = makeTool({
        execute: async () => {
          throw new Error('Tool crashed');
        },
      });

      const validationTool = ToolAdapter.toAgentTool(
        makeTool({
          execute: async () => {
            throw new Error('Tool rejected invalid params');
          },
        }),
        makeNoOpHookDispatcher(),
        {},
      );
      const executionTool = ToolAdapter.toAgentTool(failingTool, makeNoOpHookDispatcher(), {});

      await validationTool.execute('call-invalid', {});
      await executionTool.execute('call-failed', { input: 'test' });

      expectDebugLog('工具调用执行失败', {
        toolName: 'test-tool',
        toolCallId: 'call-invalid',
        errorName: 'Error',
        message: 'Tool rejected invalid params',
      });
      expectDebugLog('工具调用完成', {
        toolName: 'test-tool',
        toolCallId: 'call-invalid',
        outcome: 'execution-failed',
      });
      expectDebugLog('工具调用执行失败', {
        toolName: 'test-tool',
        toolCallId: 'call-failed',
        errorName: 'Error',
        message: 'Tool crashed',
      });
      expectDebugLog('工具调用完成', {
        toolName: 'test-tool',
        toolCallId: 'call-failed',
        outcome: 'execution-failed',
      });
    });

    it('should debug-log aborts before tool execution', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'should not run' }),
      });
      const controller = new AbortController();
      controller.abort();

      const agentTool = ToolAdapter.toAgentTool(tool, makeNoOpHookDispatcher(), {});
      await agentTool.execute('call-aborted', { input: 'secret abort payload' }, controller.signal);

      expectDebugLog('工具调用已触发', {
        toolName: 'test-tool',
        toolCallId: 'call-aborted',
        params: { input: 'secret abort payload' },
      });
      expectDebugLog('工具调用在执行前被中止', {
        toolName: 'test-tool',
        toolCallId: 'call-aborted',
      });
      expectDebugLog('工具调用完成', {
        toolName: 'test-tool',
        toolCallId: 'call-aborted',
        outcome: 'aborted',
      });
    });

    it('should debug-log result overrides', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'original result' }),
      });

      const agentTool = ToolAdapter.toAgentTool(
        tool,
        makeOverrideHookDispatcher({ content: 'overridden failure', isError: true }),
        {},
      );
      await agentTool.execute('call-override', { input: 'test' });

      expectDebugLog('工具调用结果被 after 钩子覆盖', {
        toolName: 'test-tool',
        toolCallId: 'call-override',
        override: {
          hasContent: true,
          hasDetails: false,
          hasIsError: true,
          hasTerminate: false,
        },
      });
      expectDebugLog('工具调用完成', {
        toolName: 'test-tool',
        toolCallId: 'call-override',
        outcome: 'executed',
        result: {
          contentLength: 'overridden failure'.length,
          hasDetails: false,
          isError: true,
          terminate: false,
        },
      });
    });
  });
});

function expectDebugLog(message: string, payload: Record<string, unknown>): void {
  expect(vi.mocked(globalThis.console.debug)).toHaveBeenCalledWith(
    expect.stringContaining(`[DEBUG] [tool] ${message}`),
    expect.objectContaining(payload),
  );
}
