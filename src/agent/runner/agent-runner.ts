import { randomUUID } from 'node:crypto';
import { Agent as PiAgent, type AgentTool as PiAgentTool, type StreamFn } from '@mariozechner/pi-agent-core';
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
import { extractMessageText, type AgentMessage, type AgentTool, type AgentToolResult, type ResolvedModel } from '../agent-types';
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
};

export function createProviderCacheKey(sessionKey: SessionKey): string {
  return `session:${serializeSessionKey(sessionKey)}`;
}

export function calculateToolResultBudget(
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

export function createAgentRunResult(newMessages: readonly AgentMessage[]): AgentRunResult {
  return {
    newMessages: [...newMessages],
    lastAssistant: resolveLastAssistant(newMessages),
  };
}

export function createCancelledRunResult(): AgentRunResult {
  return { newMessages: [], lastAssistant: null };
}

export function getFinalAssistantMeta(messages: readonly AgentMessage[]): Record<string, unknown> {
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
  const originalContentLength = result.content.reduce((total, block) => total + block.text.length, 0);
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
      ...(typeof result.details === 'object' && result.details !== null && !Array.isArray(result.details)
        ? result.details
        : {}),
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
  execute: (toolCallId: string, params: unknown) => Promise<unknown>;
};

export async function runAgentTask(params: AgentRunParams): Promise<AgentRunResult> {
  const { roleId, model, tools: toolDefs, history, content, sessionKey, compressionThreshold, registry } =
    params;
  if (!model.apiKey) {
    throw new Error(`未为提供者 "${model.provider}" 配置 API 密钥`);
  }

  const runId = randomUUID();
  const abortController = new AbortController();
  const runHandle: AgentRunHandle = {
    cancel: () => {
      if (!abortController.signal.aborted) {
        abortController.abort(new AgentRunCancelledError());
      }
    },
  };
  registry.registerRun(runId, runHandle, sessionKey);

  try {
    const toolResultBudget = calculateToolResultBudget(
      model,
      compressionThreshold,
      history,
      content,
    );
    const agentTools = toolDefs.map((tool) =>
      adaptToolForPiAgent(tool, toolResultBudget, abortController.signal),
    );
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
    });

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

function adaptToolForPiAgent(
  tool: AgentTool,
  toolResultBudget: { maxToolResultTokens: number; maxToolResultChars: number },
  signal: AbortSignal,
): PiAgentToolAdapter {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult> => {
      throwIfCancelled(signal);
      const result = await tool.execute(toolCallId, params, signal);
      throwIfCancelled(signal);

      if (result.isError) {
        const errorContent = result.content.map((content) => content.text).join('\n');
        logger.error('工具调用返回错误', { toolName: tool.name, error: errorContent });
        return result;
      }

      return limitToolResultContent(result, toolResultBudget);
    },
  };
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new AgentRunCancelledError();
  }
}

function createStreamFn(
  apiKey: string,
  extraBody?: Record<string, unknown>,
): StreamFn {
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
          typeof p === 'object' && p !== null ? { ...(p as Record<string, unknown>), ...extraBody } : p,
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
