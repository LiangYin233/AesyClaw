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
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from './tool-registry';

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
      execute: async (_toolCallId: string, params: unknown, signal?: AbortSignal): Promise<AgentToolResult> => {
        const sessionKey = executionContext.sessionKey ?? {
          channel: '',
          type: '',
          chatId: '',
        };

        // 1. Dispatch beforeToolCall hooks
        const beforeResult = await hookDispatcher.dispatchBeforeToolCall({
          toolName: tool.name,
          params,
          sessionKey,
        });

        // If a hook blocks the call, return an error result
        if (beforeResult.block) {
          throw new Error(beforeResult.reason ?? `Tool call "${tool.name}" was blocked by a hook`);
        }

        // If a hook provides a short-circuit result, use it directly
        if (beforeResult.shortCircuit) {
          return ToolAdapter.toRuntimeResult(beforeResult.shortCircuit);
        }

        // 2. Execute the actual tool
        let result: ToolExecutionResult;
        try {
          // If the signal is already aborted, don't execute
          if (signal?.aborted) {
            throw new Error(`Tool call "${tool.name}" was aborted`);
          }

          result = await tool.execute(params, executionContext as ToolExecutionContext);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(message);
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
          result = {
            content: override.content ?? result.content,
            details: override.details ?? result.details,
            isError: override.isError ?? result.isError,
            terminate: override.terminate ?? result.terminate,
          };
        }

        return ToolAdapter.toRuntimeResult(result);
      },
    };
  }

  private static toRuntimeResult(result: ToolExecutionResult): AgentToolResult {
    if (result.isError) {
      throw new Error(result.content);
    }

    return {
      content: [{ type: 'text', text: result.content }],
      details: result.details,
      terminate: result.terminate,
    };
  }
}
