import { randomUUID } from 'node:crypto';
import { Agent as PiAgent, type AgentTool as PiAgentTool, type StreamFn } from '@mariozechner/pi-agent-core';
import {
  streamSimple,
  type Api,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type TSchema,
  type TextContent,
} from '@mariozechner/pi-ai';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { AgentRunHandle } from '../agent-registry';
import type { AgentTool, AgentToolResult } from '../agent-types';
import { withDefaultPromptCacheModel, withDefaultPromptCacheOptions } from '../llm-cache-options';
import {
  calculateToolResultBudget,
  createAgentRunResult,
  createCancelledRunResult,
  createProviderCacheKey,
  getFinalAssistantMeta,
  limitToolResultContent,
  type AgentRunParams,
  type AgentRunResult,
} from './agent-runner-protocol';

export type { AgentRunParams, AgentRunResult } from './agent-runner-protocol';

const logger = createScopedLogger('agent-runner');

class AgentRunCancelledError extends Error {
  constructor() {
    super('Agent 处理已中止');
  }
}

type ToolProxy = {
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
      createInProcessToolProxy(tool, toolResultBudget, abortController.signal),
    );
    const agent = new PiAgent({
      initialState: {
        systemPrompt: params.prompt,
        model,
        tools: agentTools as unknown as PiAgentTool<TSchema, unknown>[],
        messages: history,
      },
      streamFn: createStreamFn(model, model.apiKey, model.extraBody),
      getApiKey: () => model.apiKey,
      sessionId: createProviderCacheKey(sessionKey),
    });

    throwIfCancelled(abortController.signal);
    await agent.prompt(content);
    await agent.waitForIdle();
    if (abortController.signal.aborted) return createCancelledRunResult();

    const newMessages = agent.state.messages.slice(history.length);
    const result = createAgentRunResult(newMessages, findLastAssistantText(newMessages));
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
    registry.unregisterRun(runId, runHandle);
  }
}

function createInProcessToolProxy(
  tool: AgentTool,
  toolResultBudget: { maxToolResultTokens: number; maxToolResultChars: number },
  signal: AbortSignal,
): ToolProxy {
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
  model: Model<Api>,
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

function findLastAssistantText(messages: readonly Message[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue;
    const text = extractMessageText(message);
    if (text.trim().length > 0) return text;
  }
  return null;
}

function extractMessageText(message: Message): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  return content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}
