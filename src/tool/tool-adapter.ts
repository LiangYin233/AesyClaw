/**
 * tool-adapter — 将 AesyClawTool 转换为 Pi-mono AgentTool 格式。
 *
 * 包装 tool.execute 以集成统一的 Hook 系统和参数验证:
 * 1. 派发 tool:beforeCall 链 — 可能阻塞工具调用
 * 2. 参数运行时验证（TypeBox schema）
 * 3. 调用实际的 tool.execute
 * 4. 派发 tool:afterCall 链 — 可能覆盖结果
 *
 * Runner 级工具结果预算处理属于 PiAgent afterToolCall，不属于这里的兼容层。
 */

import type { AgentTool, AgentToolResult } from '@aesyclaw/agent/agent-types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { IHooksBus, HookCtx } from '@aesyclaw/hook';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from './tool-registry';
import { validateParams } from './tool-validator';

const logger = createScopedLogger('tool');

/**
 * 将 AesyClawTool 转换为 AgentTool，保留 AesyClaw 插件语义。
 *
 * 适配器继续承载参数验证、执行上下文注入、tool:beforeCall / tool:afterCall 链和工具执行日志。
 * PiAgent runner 级后处理不应放进这里。
 *
 * @param tool - 要适配的 AesyClaw 工具
 * @param hooksBus - Hook 总线
 * @param executionContext - 注入到工具执行中的部分上下文
 * @returns 兼容 Pi-mono 代理运行时的 AgentTool
 */
export function toAgentTool(
  tool: AesyClawTool,
  hooksBus: IHooksBus,
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
      const { sessionKey, logContext } = createToolCallContext(tool, toolCallId, executionContext);

      logger.debug('工具调用已触发', {
        ...logContext,
        params: summarizeParams(params),
      });

      const beforeResult = await runBeforeToolHooks(tool, hooksBus, params, sessionKey, logContext);
      if (beforeResult.handled) {
        return completeToolCall(logContext, beforeResult.result, beforeResult.outcome);
      }

      const validated = validateToolCallParams(tool, params, logContext);
      if (!validated.success) {
        return completeToolCall(logContext, validated.result, 'validation-failed');
      }

      const executionResult = await executeToolSafely(
        tool,
        validated.value,
        executionContext,
        signal,
        logContext,
      );
      if (!executionResult.success) {
        return completeToolCall(logContext, executionResult.result, executionResult.outcome);
      }

      const result = await runAfterToolHooks(
        tool,
        hooksBus,
        params,
        executionResult.result,
        sessionKey,
        logContext,
      );

      return completeToolCall(logContext, result, 'executed');
    },
  };
}

type ToolCallLogContext = {
  toolName: string;
  toolCallId: string;
  owner: AesyClawTool['owner'];
  sessionKey: ToolExecutionContext['sessionKey'];
};

type ToolCallContext = {
  sessionKey: ToolExecutionContext['sessionKey'];
  logContext: ToolCallLogContext;
};

type BeforeToolHookRunResult =
  | { handled: true; result: ToolExecutionResult; outcome: 'blocked' }
  | { handled: false };

type ToolCallValidationResult =
  | { success: true; value: unknown }
  | { success: false; result: ToolExecutionResult };

type ToolExecutionRunResult =
  | { success: true; result: ToolExecutionResult }
  | { success: false; result: ToolExecutionResult; outcome: 'aborted' | 'execution-failed' };

type ToolCallLogOutcome =
  | 'executed'
  | 'blocked'
  | 'aborted'
  | 'validation-failed'
  | 'execution-failed';

function createToolCallContext(
  tool: AesyClawTool,
  toolCallId: string,
  executionContext: Partial<ToolExecutionContext>,
): ToolCallContext {
  const sessionKey = executionContext.sessionKey ?? {
    channel: '',
    type: '',
    chatId: '',
  };

  return {
    sessionKey,
    logContext: {
      toolName: tool.name,
      toolCallId,
      owner: tool.owner,
      sessionKey,
    },
  };
}

async function runBeforeToolHooks(
  tool: AesyClawTool,
  hooksBus: IHooksBus,
  params: unknown,
  sessionKey: ToolExecutionContext['sessionKey'],
  logContext: ToolCallLogContext,
): Promise<BeforeToolHookRunResult> {
  const ctx: HookCtx = {
    message: { components: [] },
    sessionKey,
    toolName: tool.name,
    toolParams: params,
  };

  const result = await hooksBus.dispatch('tool:beforeCall', ctx);

  if (result.action === 'block') {
    logger.debug('工具调用被 tool:beforeCall 链阻塞', {
      ...logContext,
      reason: result.reason,
    });

    return {
      handled: true,
      result: {
        content: result.reason ?? `工具调用 "${tool.name}" 被阻塞`,
        isError: true,
      },
      outcome: 'blocked',
    };
  }

  return { handled: false };
}

function validateToolCallParams(
  tool: AesyClawTool,
  params: unknown,
  logContext: ToolCallLogContext,
): ToolCallValidationResult {
  const validated = validateParams(tool.parameters, params);
  if (validated.success) {
    return validated;
  }

  logger.debug('工具参数验证失败', {
    ...logContext,
    error: validated.error,
  });

  return {
    success: false,
    result: {
      content: `参数验证失败: ${validated.error}`,
      isError: true,
    },
  };
}

async function executeToolSafely(
  tool: AesyClawTool,
  params: unknown,
  executionContext: Partial<ToolExecutionContext>,
  signal: AbortSignal | undefined,
  logContext: ToolCallLogContext,
): Promise<ToolExecutionRunResult> {
  try {
    if (signal?.aborted) {
      logger.debug('工具调用在执行前被中止', logContext);

      return {
        success: false,
        result: {
          content: `工具调用 "${tool.name}" 被中止`,
          isError: true,
        },
        outcome: 'aborted',
      };
    }

    return {
      success: true,
      result: await tool.execute(params, executionContext as ToolExecutionContext),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug('工具调用执行失败', {
      ...logContext,
      errorName: err instanceof Error ? err.name : typeof err,
      message,
    });

    return {
      success: false,
      result: { content: message, isError: true },
      outcome: 'execution-failed',
    };
  }
}

async function runAfterToolHooks(
  tool: AesyClawTool,
  hooksBus: IHooksBus,
  params: unknown,
  result: ToolExecutionResult,
  sessionKey: ToolExecutionContext['sessionKey'],
  logContext: ToolCallLogContext,
): Promise<ToolExecutionResult> {
  const ctx: HookCtx = {
    message: { components: [] },
    sessionKey,
    toolName: tool.name,
    toolParams: params,
    toolResult: result,
  };

  const afterResult = await hooksBus.dispatch('tool:afterCall', ctx);

  if (afterResult.action !== 'override') {
    return result;
  }

  const override = afterResult.result;
  logger.debug('工具调用结果被 tool:afterCall 链覆盖', {
    ...logContext,
    override: {
      hasContent: override.content !== result.content,
      hasDetails: override.details !== result.details,
      hasIsError: override.isError !== result.isError,
      hasTerminate: override.terminate !== result.terminate,
    },
  });

  return {
    content: override.content ?? result.content,
    details: override.details ?? result.details,
    isError: override.isError ?? result.isError,
    terminate: override.terminate ?? result.terminate,
  };
}

function completeToolCall(
  logContext: ToolCallLogContext,
  result: ToolExecutionResult,
  outcome: ToolCallLogOutcome,
): AgentToolResult {
  logger.debug('工具调用完成', {
    ...logContext,
    outcome,
    result: summarizeResult(result),
  });

  return toAgentToolResult(result);
}

function toAgentToolResult(result: ToolExecutionResult): AgentToolResult {
  return {
    content: [{ type: 'text', text: result.content }],
    details: result.details ?? {},
    isError: result.isError,
    terminate: result.terminate,
  };
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
