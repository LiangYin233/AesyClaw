/**
 * ToolAdapter unit tests.
 *
 * Tests cover: hook integration (before/after), abort signal, and error handling.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { toAgentTool } from '../../../src/tool/tool-adapter';
import type { AesyClawTool, ToolExecutionContext } from '../../../src/tool/tool-registry';
import type { IHooksBus, HookResult } from '../../../src/hook';
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

function makeNoOpHooksBus(): IHooksBus {
  return {
    register: () => {},
    unregister: () => {},
    unregisterByPrefix: () => {},
    enable: () => {},
    disable: () => {},
    isEnabled: () => false,
    async dispatch(): Promise<HookResult> {
      return { action: 'next' };
    },
    clear: () => {},
  };
}

function makeBlockingHooksBus(reason: string): IHooksBus {
  return {
    register: () => {},
    unregister: () => {},
    unregisterByPrefix: () => {},
    enable: () => {},
    disable: () => {},
    isEnabled: () => false,
    async dispatch(chain: string): Promise<HookResult> {
      if (chain === 'tool:beforeCall') {
        return { action: 'block', reason };
      }
      return { action: 'next' };
    },
    clear: () => {},
  };
}

function makeOverrideHooksBus(override: {
  content?: string;
  isError?: boolean;
  terminate?: boolean;
}): IHooksBus {
  return {
    register: () => {},
    unregister: () => {},
    unregisterByPrefix: () => {},
    enable: () => {},
    disable: () => {},
    isEnabled: () => false,
    async dispatch(chain: string): Promise<HookResult> {
      if (chain === 'tool:afterCall') {
        return {
          action: 'override',
          result: {
            content: override.content ?? 'overridden',
            details: {},
            isError: override.isError,
            terminate: override.terminate,
          },
        };
      }
      return { action: 'next' };
    },
    clear: () => {},
  };
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
      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});

      expect(agentTool.name).toBe('test-tool');
      expect(agentTool.label).toBe('test-tool');
      expect(agentTool.description).toBe('A test tool');
      expect(typeof agentTool.execute).toBe('function');
    });

    it('should execute the tool and return the result', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'Hello from tool' }),
      });

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});
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

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), context);
      await agentTool.execute('call-1', { input: 'test' });

      expect(receivedContext).toEqual(context);
    });

    it('should return validation failure for invalid system-tool parameters', async () => {
      const execute = vi.fn(async () => ({ content: 'system saw invalid params', isError: true }));
      const tool = makeTool({
        execute,
      });

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});
      const params = {};

      const result = await agentTool.execute('call-1', params);

      expect(result).toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('参数验证失败') }],
        isError: true,
      });
      expect(result.content[0]?.text).toEqual(expect.stringContaining('/input'));
      expect(execute).not.toHaveBeenCalled();
    });

    it('should pass invalid MCP-tool parameters through when external schema cannot be locally validated', async () => {
      const execute = vi.fn(async () => ({ content: 'mcp result' }));
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
        execute,
      });

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});
      const params = { max_results: 'not-a-number' };
      const result = await agentTool.execute('call-mcp', params);

      expect(result).toMatchObject({
        content: [{ type: 'text', text: 'mcp result' }],
        details: {},
        isError: undefined,
      });
      expect(execute).toHaveBeenCalledWith(params, expect.any(Object));
    });

    it('should return validation failure for invalid plugin-tool parameters', async () => {
      const execute = vi.fn(async () => ({ content: 'plugin saw invalid params', isError: true }));
      const tool = makeTool({
        owner: 'plugin:weather',
        execute,
      });

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});
      const params = {};

      const result = await agentTool.execute('call-plugin-invalid', params);

      expect(result).toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('参数验证失败') }],
        isError: true,
      });
      expect(result.content[0]?.text).toEqual(expect.stringContaining('/input'));
      expect(execute).not.toHaveBeenCalled();
    });

    it('should block execution when before hook blocks', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'should not run' }),
      });

      const agentTool = toAgentTool(tool, makeBlockingHooksBus('Blocked by policy'), {});

      await expect(agentTool.execute('call-1', {})).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Blocked by policy' }],
        details: {},
        isError: true,
      });
    });

    it('should allow after hook to override result', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'original result' }),
      });

      const agentTool = toAgentTool(
        tool,
        makeOverrideHooksBus({ content: 'overridden result' }),
        {},
      );
      const result = await agentTool.execute('call-1', { input: 'test' });

      expect(result.content).toEqual([{ type: 'text', text: 'overridden result' }]);
    });

    it('should preserve tool error results as structured failures', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'Tool failed', isError: true }),
      });

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});

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

      const agentTool = toAgentTool(
        tool,
        makeOverrideHooksBus({ content: 'overridden failure', isError: true }),
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

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});
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

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});
      await expect(
        agentTool.execute('call-1', { input: 'test' }, controller.signal),
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: '工具调用 "test-tool" 被中止' }],
        details: {},
        isError: true,
      });
    });

    it('should use default sessionKey when not provided in context', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'ok' }),
      });

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});
      // Should not throw — just uses empty sessionKey
      const result = await agentTool.execute('call-1', { input: 'test' });
      expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    });

    it('should debug-log invocation and completion with actual parameter values', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'secret tool result', details: { recordCount: 1 } }),
      });

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});
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

    it('should debug-log before-hook block paths', async () => {
      const tool = makeTool({
        execute: async () => ({ content: 'should not run' }),
      });
      const blockedTool = toAgentTool(tool, makeBlockingHooksBus('Blocked by policy'), {});

      await blockedTool.execute('call-blocked', { input: 'test' });

      expectDebugLog('工具调用被 tool:beforeCall 链阻塞', {
        toolName: 'test-tool',
        toolCallId: 'call-blocked',
        reason: 'Blocked by policy',
      });
      expectDebugLog('工具调用完成', {
        toolName: 'test-tool',
        toolCallId: 'call-blocked',
        outcome: 'blocked',
      });
    });

    it('should debug-log execution failures from downstream tool implementations', async () => {
      const failingTool = makeTool({
        execute: async () => {
          throw new Error('Tool crashed');
        },
      });

      const executionTool = toAgentTool(failingTool, makeNoOpHooksBus(), {});

      await executionTool.execute('call-failed', { input: 'test' });

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

      const agentTool = toAgentTool(tool, makeNoOpHooksBus(), {});
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

      const agentTool = toAgentTool(
        tool,
        makeOverrideHooksBus({ content: 'overridden failure', isError: true }),
        {},
      );
      await agentTool.execute('call-override', { input: 'test' });

      expectDebugLog('工具调用结果被 tool:afterCall 链覆盖', {
        toolName: 'test-tool',
        toolCallId: 'call-override',
        override: {
          hasContent: true,
          hasDetails: true,
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
          hasDetails: true,
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
