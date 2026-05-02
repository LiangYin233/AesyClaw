/**
 * tool-adapter — 将 AesyClawTool 转换为 Pi-mono AgentTool 格式。
 *
 * 包装 tool.execute 以集成插件钩子系统:
 * 1. 派发 beforeToolCall 钩子 — 可能阻塞或短路
 * 2. 调用实际的 tool.execute
 * 3. 派发 afterToolCall 钩子 — 可能覆盖结果
 */

import type { AgentTool, AgentToolResult } from '../agent/agent-types';
import { createScopedLogger } from '../core/logger';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from './tool-registry';

const logger = createScopedLogger('tool');

/**
 * 将 AesyClawTool 转换为 AgentTool,使用 before/after 钩子派发包装 execute。
 *
 * 适配器使用钩子派发包装工具的 execute 函数,以便插件
 * beforeToolCall/afterToolCall 钩子可以拦截或修改工具调用。
 *
 * @param tool - 要适配的 AesyClaw 工具
 * @param toolHookDispatcher - 派发插件钩子
 * @param executionContext - 注入到工具执行中的部分上下文
 * @returns 兼容 Pi-mono 代理运行时的 AgentTool
 */
export function toAgentTool(
  tool: AesyClawTool,
  toolHookDispatcher: HookDispatcher,
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
        logger.debug('工具调用完成', {
          ...logContext,
          outcome,
          result: summarizeResult(result),
        });

        return toRuntimeResult(result);
      };

      logger.debug('工具调用已触发', {
        ...logContext,
        params: summarizeParams(params),
      });

      // 1. 派发 beforeToolCall 钩子
      const beforeResult = await toolHookDispatcher.dispatchBeforeToolCall({
        toolName: tool.name,
        params,
        sessionKey,
      });

      if (beforeResult.block) {
        logger.debug('工具调用被 before 钩子阻塞', {
          ...logContext,
          hasReason: beforeResult.reason !== undefined,
        });

        return complete(
          {
            content: beforeResult.reason ?? `工具调用 "${tool.name}" 被钩子阻塞`,
            isError: true,
          },
          'blocked',
        );
      }

      if (beforeResult.shortCircuit) {
        logger.debug('工具调用被 before 钩子短路', {
          ...logContext,
          result: summarizeResult(beforeResult.shortCircuit),
        });

        return complete(beforeResult.shortCircuit, 'short-circuited');
      }

      // 2. 执行实际工具
      let result: ToolExecutionResult;
      try {
        if (signal?.aborted) {
          logger.debug('工具调用在执行前被中止', logContext);

          return complete(
            {
              content: `工具调用 "${tool.name}" 被中止`,
              isError: true,
            },
            'aborted',
          );
        }

        result = await tool.execute(params, executionContext as ToolExecutionContext);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('工具调用执行失败', {
          ...logContext,
          errorName: err instanceof Error ? err.name : typeof err,
          message,
        });

        return complete({ content: message, isError: true }, 'execution-failed');
      }

      // 3. 派发 afterToolCall 钩子 — 可能覆盖结果
      const afterResult = await toolHookDispatcher.dispatchAfterToolCall({
        toolName: tool.name,
        params,
        result,
        sessionKey,
      });

      if (afterResult.override) {
        const override = afterResult.override;
        logger.debug('工具调用结果被 after 钩子覆盖', {
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

function toRuntimeResult(result: ToolExecutionResult): AgentToolResult {
  return {
    content: [{ type: 'text', text: result.content }],
    details: result.details ?? {},
    isError: result.isError,
    terminate: result.terminate,
  };
}

type ToolCallLogOutcome =
  | 'executed'
  | 'blocked'
  | 'short-circuited'
  | 'aborted'
  | 'execution-failed';

function summarizeParams(params: unknown): Record<string, unknown> {
  if (params === null || params === undefined) {
    return {};
  }

  if (typeof params === 'object') {
    if (Array.isArray(params)) {
      return { length: params.length };
    }
    return params as Record<string, unknown>;
  }

  return { value: params };
}

function summarizeResult(result: ToolExecutionResult): Record<string, unknown> {
  return {
    contentLength: result.content.length,
    hasDetails: result.details !== undefined,
    isError: result.isError === true,
    terminate: result.terminate === true,
  };
}
