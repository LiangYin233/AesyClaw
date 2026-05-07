/**
 * tool-adapter — 将 AesyClawTool 转换为 Pi-mono AgentTool 格式。
 *
 * 包装 tool.execute 以集成插件钩子系统和参数验证:
 * 1. 参数运行时验证（TypeBox schema）
 * 2. 派发 beforeToolCall 钩子 — 可能阻塞或短路
 * 3. 调用实际的 tool.execute
 * 4. 派发 afterToolCall 钩子 — 可能覆盖结果
 */

import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { AgentTool, AgentToolResult } from '@aesyclaw/agent/agent-types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
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

        return {
          content: [{ type: 'text', text: result.content }],
          details: result.details ?? {},
          isError: result.isError,
          terminate: result.terminate,
        };
      };

      logger.debug('工具调用已触发', {
        ...logContext,
        params: summarizeParams(params),
      });

      // 1. 派发 beforeToolCall 钩子
      const beforeResult = await toolHookDispatcher.beforeToolCall({
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

      // 2. 参数运行时验证
      const validated = validateParams(tool.parameters, params);
      if (!validated.success) {
        logger.debug('工具参数验证失败', {
          ...logContext,
          error: validated.error,
        });

        return complete(
          {
            content: `参数验证失败: ${validated.error}`,
            isError: true,
          },
          'validation-failed',
        );
      }

      // 3. 执行实际工具
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

        result = await tool.execute(validated.value, executionContext as ToolExecutionContext);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('工具调用执行失败', {
          ...logContext,
          errorName: err instanceof Error ? err.name : typeof err,
          message,
        });

        return complete({ content: message, isError: true }, 'execution-failed');
      }

      // 4. 派发 afterToolCall 钩子 — 可能覆盖结果
      const afterResult = await toolHookDispatcher.afterToolCall({
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

type ToolCallLogOutcome =
  | 'executed'
  | 'blocked'
  | 'short-circuited'
  | 'aborted'
  | 'validation-failed'
  | 'execution-failed';

/**
 * 验证工具参数是否符合 schema。
 * 应用默认值并检查类型正确性。
 */
function validateParams(
  schema: TSchema,
  params: unknown,
): { success: true; value: unknown } | { success: false; error: string } {
  // 应用默认值
  const withDefaults = Value.Default(schema, params);

  // 检查 schema
  if (!Value.Check(schema, withDefaults)) {
    const errors = [...Value.Errors(schema, withDefaults)]
      .slice(0, 3) // 最多报告 3 个错误
      .map((e) => `${e.path}: ${e.message}`)
      .join('; ');

    return { success: false, error: errors || '未知验证错误' };
  }

  return { success: true, value: withDefaults };
}

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
