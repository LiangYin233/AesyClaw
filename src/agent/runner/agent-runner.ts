import { randomUUID } from 'node:crypto';
import {
  Agent as PiAgent,
  type AfterToolCallContext,
  type AfterToolCallResult,
  type AgentTool as PiAgentTool,
  type StreamFn,
} from '@mariozechner/pi-agent-core';
import {
  streamSimple,
  type Api,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type TSchema,
} from '@mariozechner/pi-ai';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { AgentRegistry, AgentRunHandle } from '../agent-registry';
import {
  extractMessageText,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  type ResolvedModel,
} from '../agent-types';
import { serializeSessionKey, type SessionKey } from '@aesyclaw/core/types';
import { withDefaultPromptCacheModel, withDefaultPromptCacheOptions } from '../llm-cache-options';

const logger = createScopedLogger('agent-runner');

export type AgentRunParams = {
  roleId: string;
  model: ResolvedModel;
  prompt: string;
  tools: AgentTool[];
  history: AgentMessage[];
  content: string;
  sessionKey: SessionKey;
  compressionThreshold: number;
  registry: AgentRegistry;
};

export type AgentRunResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
  cancelled: boolean;
};

export function createProviderCacheKey(sessionKey: SessionKey): string {
  return `session:${serializeSessionKey(sessionKey)}`;
}

function calculateToolResultBudget(
  model: ResolvedModel,
  compressionThreshold: number,
  history: readonly AgentMessage[],
  content: string,
): { maxToolResultTokens: number; maxToolResultChars: number } {
  const compressionLimitTokens = Math.floor(model.contextWindow * compressionThreshold);
  const historyTextLength = history.reduce(
    (total, message) => total + extractMessageText(message).length,
    0,
  );
  const usedTokens = Math.ceil(historyTextLength / 3.5) + Math.ceil(content.length / 3.5);
  const remainingTokens = Math.max(0, compressionLimitTokens - usedTokens);
  const maxToolResultTokens = Math.floor(remainingTokens * 0.5);
  return {
    maxToolResultTokens,
    maxToolResultChars: Math.floor(maxToolResultTokens * 3.5),
  };
}

function createAgentRunResult(newMessages: readonly AgentMessage[]): AgentRunResult {
  return {
    newMessages: [...newMessages],
    lastAssistant: resolveLastAssistant(newMessages),
    cancelled: false,
  };
}

function createCancelledRunResult(): AgentRunResult {
  return { newMessages: [], lastAssistant: null, cancelled: true };
}

function getFinalAssistantMeta(messages: readonly AgentMessage[]): Record<string, unknown> {
  const finalAssistant = findFinalAssistant(messages);
  if (!finalAssistant) return { lastAssistantRole: null };
  const record = finalAssistant as unknown as Record<string, unknown>;
  return {
    lastAssistantRole: finalAssistant.role,
    lastAssistantStopReason: record['stopReason'],
    lastAssistantErrorMessage: record['errorMessage'],
    lastAssistantTextLength: extractAssistantText(finalAssistant).length,
  };
}

export function limitToolResultContent<T extends AgentToolResult>(
  result: T,
  budget: { maxToolResultTokens: number; maxToolResultChars: number },
): T {
  const originalContentLength = result.content.reduce(
    (total, block) => total + block.text.length,
    0,
  );
  if (originalContentLength <= budget.maxToolResultChars) return result;

  let remainingChars = budget.maxToolResultChars;
  const content = result.content.map((block) => {
    const text = block.text.slice(0, Math.max(0, remainingChars));
    remainingChars -= text.length;
    return { ...block, text };
  });
  const truncatedContentLength = content.reduce((total, block) => total + block.text.length, 0);

  return {
    ...result,
    content,
    details: {
      ...(isPlainRecord(result.details) ? result.details : {}),
      truncated: true,
      originalContentLength,
      truncatedContentLength,
      maxToolResultTokens: budget.maxToolResultTokens,
    },
  };
}

class AgentRunCancelledError extends Error {
  constructor() {
    super('Agent 处理已中止');
  }
}

type PiAgentToolAdapter = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
};

export async function runAgentTask(params: AgentRunParams): Promise<AgentRunResult> {
  const {
    roleId,
    model,
    tools: toolDefs,
    history,
    content,
    sessionKey,
    compressionThreshold,
    registry,
  } = params;
  if (!model.apiKey) {
    throw new Error(`未为提供者 "${model.provider}" 配置 API 密钥`);
  }

  const runId = randomUUID();
  const abortController = new AbortController();
  const toolResultBudget = calculateToolResultBudget(model, compressionThreshold, history, content);
  const agentTools = toolDefs.map((tool) => adaptToolForPiAgent(tool, abortController.signal));
  const agent = new PiAgent({
    initialState: {
      systemPrompt: params.prompt,
      model,
      tools: agentTools as unknown as PiAgentTool<TSchema, unknown>[],
      messages: history,
    },
    streamFn: createStreamFn(model.apiKey, model.extraBody),
    getApiKey: () => model.apiKey,
    sessionId: createProviderCacheKey(sessionKey),
    afterToolCall: createToolResultBudgetHandler(toolResultBudget),
  });
  const runHandle: AgentRunHandle = {
    cancel: () => {
      if (!abortController.signal.aborted) {
        abortController.abort(new AgentRunCancelledError());
      }
      agent.abort();
    },
  };
  registry.registerRun(runId, runHandle, sessionKey);

  try {
    throwIfCancelled(abortController.signal);
    await agent.prompt(content);
    await agent.waitForIdle();
    if (abortController.signal.aborted) return createCancelledRunResult();

    const newMessages = agent.state.messages.slice(history.length);
    const result = createAgentRunResult(newMessages);
    logger.info('Agent 处理已完成', {
      sessionKey,
      role: roleId,
      runId,
      ...getFinalAssistantMeta(result.newMessages),
    });
    return result;
  } catch (err) {
    if (abortController.signal.aborted || err instanceof AgentRunCancelledError) {
      return createCancelledRunResult();
    }
    throw err;
  } finally {
    registry.unregisterRun(runId);
  }
}

function adaptToolForPiAgent(tool: AgentTool, signal: AbortSignal): PiAgentToolAdapter {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (
      toolCallId: string,
      params: unknown,
      piSignal?: AbortSignal,
    ): Promise<AgentToolResult> => {
      const toolSignal = piSignal ?? signal;
      throwIfCancelled(signal);
      throwIfCancelled(toolSignal);

      const result = await tool.execute(toolCallId, params, toolSignal);

      throwIfCancelled(signal);
      throwIfCancelled(toolSignal);

      if (result.isError) {
        const errorContent = result.content.map((content) => content.text).join('\n');
        logger.error('工具调用返回错误', { toolName: tool.name, error: errorContent });
      }

      return result;
    },
  };
}

function createToolResultBudgetHandler(toolResultBudget: {
  maxToolResultTokens: number;
  maxToolResultChars: number;
}): (
  context: AfterToolCallContext,
  signal?: AbortSignal,
) => Promise<AfterToolCallResult | undefined> {
  return async (context, signal) => {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new AgentRunCancelledError();
    }

    const result = context.result as AgentToolResult;
    if (context.isError || result.isError) return undefined;

    const limited = limitToolResultContent(result, toolResultBudget);
    if (limited === result) return undefined;

    const override: AfterToolCallResult = {
      content: limited.content,
      details: limited.details,
    };
    if (limited.isError !== undefined) override.isError = limited.isError;
    if (limited.terminate !== undefined) override.terminate = limited.terminate;
    return override;
  };
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new AgentRunCancelledError();
  }
}

function createStreamFn(apiKey: string, extraBody?: Record<string, unknown>): StreamFn {
  const hasExtra = extraBody !== undefined && Object.keys(extraBody).length > 0;
  if (!hasExtra) {
    return (m: Model<Api>, ctx: Context, opts?: SimpleStreamOptions) => {
      const cacheModel = withDefaultPromptCacheModel(m);
      return streamSimple(
        cacheModel,
        ctx,
        withDefaultPromptCacheOptions(cacheModel, {
          ...opts,
          apiKey,
        }),
      );
    };
  }
  return (m: Model<Api>, ctx: Context, opts?: SimpleStreamOptions) => {
    const cacheModel = withDefaultPromptCacheModel(m);
    return streamSimple(
      cacheModel,
      ctx,
      withDefaultPromptCacheOptions(cacheModel, {
        ...opts,
        apiKey,
        onPayload: (p: unknown): unknown =>
          typeof p === 'object' && p !== null
            ? { ...(p as Record<string, unknown>), ...extraBody }
            : p,
      }),
    );
  };
}

function resolveLastAssistant(newMessages: readonly AgentMessage[]): string | null {
  const finalAssistant = findFinalAssistant(newMessages);
  if (!finalAssistant) return null;

  const errorMessage = getAssistantErrorMessage(finalAssistant);
  if (errorMessage) return `[模型错误: ${errorMessage}]`;

  const text = extractAssistantText(finalAssistant).trim();
  return text.length > 0 ? text : null;
}

function findFinalAssistant(messages: readonly AgentMessage[]): AgentMessage | null {
  for (const message of [...messages].reverse()) {
    if (message.role === 'assistant') return message;
  }
  return null;
}

function getAssistantErrorMessage(message: AgentMessage): string | null {
  if (message.role !== 'assistant') return null;
  const record = message as unknown as Record<string, unknown>;
  if (record['stopReason'] !== 'error') return null;
  return typeof record['errorMessage'] === 'string' && record['errorMessage'].trim().length > 0
    ? record['errorMessage'].trim()
    : '模型调用失败但未返回错误详情';
}

function extractAssistantText(message: AgentMessage): string {
  if (message.role !== 'assistant') return '';
  return message.content
    .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
    .map((content) => content.text)
    .join('\n');
}

/** 判断值是否为非 null、非数组的普通对象 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
