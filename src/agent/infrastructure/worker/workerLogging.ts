import type { LLMMessage, LLMResponse, ToolDefinition } from '../../../types.js';
import { LLMProvider } from '../../../platform/providers/base.js';
import type { LogLevel } from '../../../platform/observability/index.js';
import type { WorkerLogMessage } from './protocol.js';

export interface WorkerLogContextFields {
  sessionKey?: string;
  executionId: string;
  agentName?: string;
  model?: string;
  childPid?: number | null;
}

export function prepareWorkerLogMessage(
  message: WorkerLogMessage,
  inheritedFields: Record<string, unknown>
): WorkerLogMessage {
  return {
    ...message,
    fields: {
      ...inheritedFields,
      executionId: message.executionId,
      ...(message.fields || {})
    }
  };
}

export function createWorkerLoggedProvider(
  baseProvider: LLMProvider,
  context: WorkerLogContextFields,
  log: (level: LogLevel, message: string, fields?: Record<string, unknown>) => void,
  onActivity?: (activity: {
    sessionKey?: string;
    executionId: string;
    requestId: string;
    model?: string;
    active: boolean;
  }) => void
): LLMProvider {
  let requestSeq = 0;

  return new class extends LLMProvider {
    async chat(
      messages: LLMMessage[],
      tools?: ToolDefinition[],
      model?: string,
      options?: {
        maxTokens?: number;
        temperature?: number;
        reasoning?: boolean;
        signal?: AbortSignal;
      }
    ): Promise<LLMResponse> {
      const startedAt = Date.now();
      const requestId = `llm-${++requestSeq}`;
      const modelName = model || context.model;
      const logFields = {
        ...context,
        model: modelName,
        requestId
      };

      onActivity?.({
        sessionKey: context.sessionKey,
        executionId: context.executionId,
        requestId,
        model: modelName,
        active: true
      });
      log('info', 'worker LLM 请求开始', logFields);

      try {
        const result = await baseProvider.chat(messages, tools, model, options);
        onActivity?.({
          sessionKey: context.sessionKey,
          executionId: context.executionId,
          requestId,
          model: modelName,
          active: false
        });
        log('info', 'worker LLM 请求完成', {
          ...logFields,
          durationMs: Date.now() - startedAt,
          finishReason: result.finishReason
        });
        return result;
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        onActivity?.({
          sessionKey: context.sessionKey,
          executionId: context.executionId,
          requestId,
          model: modelName,
          active: false
        });
        log(normalizedError.name === 'AbortError' ? 'warn' : 'error', 'worker LLM 请求失败', {
          ...logFields,
          durationMs: Date.now() - startedAt,
          error: normalizedError
        });
        throw error;
      }
    }
  }();
}
