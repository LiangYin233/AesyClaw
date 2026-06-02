/**
 * agent-runner — Agent LLM 运行循环。
 *
 * 核心职责：创建 PiAgent 实例，驱动一次完整的 LLM 提示循环。
 * 工具适配、结果解析、事件转换委托给 runner/ 子模块。
 */

import { randomUUID } from 'node:crypto';
import {
  Agent as PiAgent,
  type AgentEvent,
  type AgentTool as PiAgentTool,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import type { TSchema } from '@earendil-works/pi-ai';
import type { AgentMessage, AgentTool, ResolvedModel } from './types';
import type { IHooksBus } from '@aesyclaw/hook';
import { serializeSessionKey, type OutboundSignal, type SessionKey } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { ErrorFactory } from '@aesyclaw/core/errors';
import type { AgentRegistry, AgentRunHandle } from './registry';
import {
  adaptToolForPiAgent,
  calculateToolResultBudget,
  createToolResultBudgetHandler,
} from './runner/tool-runtime';
import {
  createAgentRunResult,
  createCancelledRunResult,
  getFinalAssistantMeta,
} from './runner/run-parser';
import { convertAgentEvent } from './runner/event-converter';
import { throwIfCancelled, AgentRunCancelledError } from './runner/shared';
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
  hooksBus: IHooksBus;
  streamFn: StreamFn;
  onEvent?: (event: OutboundSignal) => void;
};

export type AgentRunResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
  cancelled: boolean;
};

export function createProviderCacheKey(sessionKey: SessionKey): string {
  return `session:${serializeSessionKey(sessionKey)}`;
}

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
    hooksBus,
  } = params;
  if (!model.apiKey) {
    throw ErrorFactory.config.invalid(`未为提供者 "${model.provider}" 配置 API 密钥`, {
      configKey: `providers.${model.provider}.apiKey`,
      provider: model.provider,
      modelId: model.id,
    });
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
    streamFn: params.streamFn,
    getApiKey: () => model.apiKey,
    sessionId: createProviderCacheKey(sessionKey),
    afterToolCall: createToolResultBudgetHandler(toolResultBudget, hooksBus, sessionKey),
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

  // ── 订阅 pi-agent-core 事件 → StreamEventMeta ────────────
  let chunkIndex = 0;
  if (params.onEvent) {
    const onEvent = params.onEvent;
    agent.subscribe((event: AgentEvent) => {
      const meta = convertAgentEvent(event, chunkIndex, params.sessionKey);
      if (meta) {
        if (meta.kind === 'chunk') {
          chunkIndex++;
        }
        onEvent(meta);
      }
    });
  }

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
