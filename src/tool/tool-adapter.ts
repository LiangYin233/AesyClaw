/**
 * ToolAdapter — converts AesyClawTool to Pi-mono AgentTool format.
 *
 * Wraps tool.execute to integrate with the plugin hook system:
 * 1. Dispatches beforeToolCall hooks — may block or short-circuit
 * 2. Calls the actual tool.execute
 * 3. Dispatches afterToolCall hooks — may override the result
 *
 */

import type { AgentTool, AgentToolResult } from '../agent/agent-types';
import { createScopedLogger } from '../core/logger';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from './tool-registry';

const logger = createScopedLogger('tool');

/**
 * Adapts an AesyClawTool into the Pi-mono AgentTool interface.
 *
 * The adapter wraps the tool's execute function with hook dispatching
 * so that plugin beforeToolCall/afterToolCall hooks can intercept
 * or modify tool invocations.
 */
export class ToolAdapter {
  /**
   * Convert an AesyClawTool to an AgentTool, wrapping execute with
   * before/after hook dispatching.
   *
   * @param tool - The AesyClaw tool to adapt
   * @param hookDispatcher - Dispatches plugin hooks
   * @param executionContext - Partial context injected into tool execute
   * @returns An AgentTool compatible with the Pi-mono agent runtime
   */
  static toAgentTool(
    tool: AesyClawTool,
    hookDispatcher: HookDispatcher,
    executionContext: Partial<ToolExecutionContext>,
  ): AgentTool {
    return {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
      ): Promise<AgentToolResult> => {
        const sessionKey = executionContext.sessionKey ?? {
          channel: '',
          type: '',
          chatId: '',
        };
        const logContext = {
          toolName: tool.name,
          toolCallId,
          owner: tool.owner,
          sessionKey,
        };
        const complete = (
          result: ToolExecutionResult,
          outcome: ToolCallLogOutcome,
        ): AgentToolResult => {
          logger.debug('Tool call completed', {
            ...logContext,
            outcome,
            result: summarizeResult(result),
          });

          return ToolAdapter.toRuntimeResult(result);
        };

        logger.debug('Tool call invoked', {
          ...logContext,
          params: summarizeParams(params),
        });

        // 1. Dispatch beforeToolCall hooks
        const beforeResult = await hookDispatcher.dispatchBeforeToolCall({
          toolName: tool.name,
          params,
          sessionKey,
        });

        // If a hook blocks the call, return an error result
        if (beforeResult.block) {
          logger.debug('Tool call blocked by before hook', {
            ...logContext,
            hasReason: beforeResult.reason !== undefined,
          });

          return complete(
            {
              content: beforeResult.reason ?? `Tool call "${tool.name}" was blocked by a hook`,
              isError: true,
            },
            'blocked',
          );
        }

        // If a hook provides a short-circuit result, use it directly
        if (beforeResult.shortCircuit) {
          logger.debug('Tool call short-circuited by before hook', {
            ...logContext,
            result: summarizeResult(beforeResult.shortCircuit),
          });

          return complete(beforeResult.shortCircuit, 'short-circuited');
        }

        // 2. Execute the actual tool
        let result: ToolExecutionResult;
        try {
          // If the signal is already aborted, don't execute
          if (signal?.aborted) {
            logger.debug('Tool call aborted before execution', logContext);

            return complete(
              {
                content: `Tool call "${tool.name}" was aborted`,
                isError: true,
              },
              'aborted',
            );
          }

          result = await tool.execute(params, executionContext as ToolExecutionContext);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.debug('Tool call execution failed', {
            ...logContext,
            errorName: err instanceof Error ? err.name : typeof err,
            message,
          });

          return complete({ content: message, isError: true }, 'execution-failed');
        }

        // 3. Dispatch afterToolCall hooks — may override the result
        const afterResult = await hookDispatcher.dispatchAfterToolCall({
          toolName: tool.name,
          params,
          result,
          sessionKey,
        });

        if (afterResult.override) {
          const override = afterResult.override;
          logger.debug('Tool call result overridden by after hook', {
            ...logContext,
            override: {
              hasContent: override.content !== undefined,
              hasDetails: override.details !== undefined,
              hasIsError: override.isError !== undefined,
              hasTerminate: override.terminate !== undefined,
            },
          });

          result = {
            content: override.content ?? result.content,
            details: override.details ?? result.details,
            isError: override.isError ?? result.isError,
            terminate: override.terminate ?? result.terminate,
          };
        }

        return complete(result, 'executed');
      },
    };
  }

  private static toRuntimeResult(result: ToolExecutionResult): AgentToolResult {
    return {
      content: [{ type: 'text', text: result.content }],
      details: result.details ?? {},
      isError: result.isError,
      terminate: result.terminate,
    };
  }
}

type ToolCallLogOutcome =
  | 'executed'
  | 'blocked'
  | 'short-circuited'
  | 'aborted'
  | 'execution-failed';

function summarizeParams(params: unknown): Record<string, unknown> {
  if (params === null) {
    return { kind: 'null' };
  }

  if (Array.isArray(params)) {
    return { kind: 'array', length: params.length };
  }

  if (typeof params === 'object') {
    const keys = Object.keys(params as Record<string, unknown>);
    return { kind: 'object', keys, keyCount: keys.length };
  }

  return { kind: typeof params };
}

function summarizeResult(result: ToolExecutionResult): Record<string, unknown> {
  return {
    contentLength: result.content.length,
    hasDetails: result.details !== undefined,
    isError: result.isError === true,
    terminate: result.terminate === true,
  };
}
