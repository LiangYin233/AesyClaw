import type { Worker } from 'node:worker_threads';
import {
  extractMessageText,
  type AgentMessage,
  type AgentTool,
  type ResolvedModel,
} from '../agent-types';
import type { AgentRegistry } from '../agent-registry';
import type { SessionKey } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type {
  HostToWorkerInitMessage,
  HostToWorkerToolResultMessage,
  WorkerToHostMessage,
  WorkerToHostToolCallMessage,
} from './agent-worker-ipc';

const logger = createScopedLogger('agent-worker-protocol');

/**
 * 主线程启动 Worker 任务所需的完整运行参数。
 */
export type WorkerRunParams = {
  /** 当前执行的角色标识，用于日志和 Worker 会话隔离。 */
  roleId: string;
  /** 已解析的模型配置，包含 API 类型、密钥和上下文窗口。 */
  model: ResolvedModel;
  /** 注入 Worker 中 PiAgent 的系统提示。 */
  prompt: string;
  /** 当前角色可用的工具代理定义。 */
  tools: AgentTool[];
  /** 当前会话历史消息。 */
  history: AgentMessage[];
  /** 本轮用户输入文本。 */
  content: string;
  /** 当前会话标识，用于取消和日志关联。 */
  sessionKey: SessionKey;
  /** 触发上下文压缩前可使用的上下文窗口比例。 */
  compressionThreshold: number;
  /** Agent 与 Worker 生命周期注册中心。 */
  registry: AgentRegistry;
};

/**
 * Worker 完成一次 Agent 执行后返回给主线程的结果。
 */
export type WorkerRunResult = {
  /** 本轮执行新增的 Agent 消息。 */
  newMessages: AgentMessage[];
  /** 最终助手文本；无可用文本时为 null。 */
  lastAssistant: string | null;
};

export type WorkerToolCallContext = {
  /** 当前运行的 Node Worker 实例。 */
  worker: Worker;
  /** 按工具名称索引的可执行工具集合。 */
  toolMap: Map<string, AgentTool>;
  /** 单次工具结果可回传的最大预算。 */
  toolResultBudget: { maxToolResultTokens: number; maxToolResultChars: number };
};

/**
 * Worker 消息处理期间需要共享的运行上下文。
 */
export type WorkerRunContext = WorkerToolCallContext & {
  /** 当前执行的角色标识。 */
  roleId: string;
  /** 当前 Worker 运行标识。 */
  runId: string;
  /** 当前会话标识。 */
  sessionKey: SessionKey;
  /** 将 host 侧 Promise 标记为已进入终态。 */
  markSettled: () => void;
  /** 解绑监听器、注销 registry 并终止 Worker。 */
  cleanup: () => void;
};

/**
 * Worker 运行 Promise 的完成回调。
 */
export type WorkerRunPromiseHandlers = {
  /** 以 WorkerRunResult 完成本轮执行。 */
  resolve: (result: WorkerRunResult) => void;
  /** 以错误终止本轮执行。 */
  reject: (reason?: unknown) => void;
};

/**
 * 构建发送给 Worker 线程入口的初始化消息。
 *
 * @param params - Worker 运行参数
 * @param runId - 当前 Worker 运行标识
 * @returns Worker 初始化消息
 */
export function createInitMessage(params: WorkerRunParams, runId: string): HostToWorkerInitMessage {
  const { model, prompt, tools, history, content, sessionKey } = params;
  if (!model.apiKey) {
    throw new Error(`未为提供者 "${model.provider}" 配置 API 密钥`);
  }
  return {
    type: 'init',
    systemPrompt: prompt,
    model,
    apiKey: model.apiKey,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    history,
    content,
    extraBody: model.extraBody,
    sessionId: createProviderCacheKey(sessionKey),
  };
}

export function createProviderCacheKey(sessionKey: SessionKey): string {
  return `session:${sessionKey.channel}:${sessionKey.type}:${sessionKey.chatId}`;
}

/**
 * 处理 Worker 发回主线程的 IPC 消息。
 *
 * @param context - Worker 运行上下文
 * @param handlers - Promise 完成回调
 * @param msg - Worker IPC 消息
 */
export async function handleWorkerMessage(
  context: WorkerRunContext,
  handlers: WorkerRunPromiseHandlers,
  msg: WorkerToHostMessage,
): Promise<void> {
  if (msg.type === 'done') {
    context.markSettled();
    const result = normalizeWorkerDoneMessage(msg);
    const lastAssistantMeta = getFinalAssistantMeta(result.newMessages);
    logger.info('Agent 处理已完成', {
      sessionKey: context.sessionKey,
      role: context.roleId,
      runId: context.runId,
      ...lastAssistantMeta,
    });
    context.cleanup();
    handlers.resolve(result);
    return;
  }

  if (msg.type === 'toolCall') {
    await handleToolCall(context, msg);
    return;
  }

  if (msg.type === 'fatal') {
    context.markSettled();
    context.cleanup();
    handlers.reject(new Error(typeof msg.message === 'string' ? msg.message : String(msg.message)));
  }
}

/**
 * 根据当前上下文占用估算单次工具结果回传预算。
 *
 * @param model - 已解析的模型配置
 * @param compressionThreshold - 压缩阈值比例
 * @param history - 当前会话历史消息
 * @param content - 本轮用户输入文本
 * @returns 工具结果 token 和字符预算
 */
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
  const usedTokens = Math.ceil(historyTextLength / 4) + Math.ceil(content.length / 4);
  const remainingTokens = Math.max(0, compressionLimitTokens - usedTokens);
  const maxToolResultTokens = Math.floor(remainingTokens * 0.5);

  return {
    maxToolResultTokens,
    maxToolResultChars: maxToolResultTokens * 4,
  };
}

/**
 * 执行 Worker 请求的工具调用，并将结果回传给 Worker。
 *
 * @param context - 工具调用上下文
 * @param msg - 工具调用 IPC 消息
 */
async function handleToolCall(
  context: WorkerToolCallContext,
  msg: WorkerToHostToolCallMessage,
): Promise<void> {
  const toolName = String(msg.toolName);
  const tool = context.toolMap.get(toolName);
  if (!tool) {
    postToolError(context.worker, msg.callId, `工具 "${toolName}" 未找到`);
    return;
  }

  try {
    const toolResult = await tool.execute(String(msg.toolCallId), msg.params);
    if (toolResult.isError) {
      const errorContent =
        typeof toolResult.content === 'string'
          ? toolResult.content
          : JSON.stringify(toolResult.content);
      logger.error('工具调用返回错误', { toolName: msg.toolName, error: errorContent });
      postToolError(context.worker, msg.callId, errorContent, true);
      return;
    }

    context.worker.postMessage({
      type: 'toolResult',
      callId: msg.callId,
      result: limitToolResultContent(toolResult, context.toolResultBudget),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('工具调用执行失败', { toolName: msg.toolName, error: errMsg });
    postToolError(context.worker, msg.callId, errMsg);
  }
}

/**
 * 向 Worker 发送工具调用错误结果。
 *
 * @param worker - 当前 Worker 实例
 * @param callId - IPC 往返标识
 * @param error - 错误文本
 * @param isError - 是否标记为模型可见的工具错误
 */
function postToolError(worker: Worker, callId: unknown, error: string, isError?: true): void {
  const message: HostToWorkerToolResultMessage = {
    type: 'toolResult',
    callId,
    error,
    ...(isError === true ? { isError } : {}),
  };
  worker.postMessage(message);
}

/**
 * 将 Worker done 消息转换为主线程使用的运行结果。
 *
 * @param msg - Worker done 消息
 * @returns 标准化后的运行结果
 */
function normalizeWorkerDoneMessage(msg: Record<string, unknown>): WorkerRunResult {
  const newMessages = Array.isArray(msg['newMessages'])
    ? (msg['newMessages'] as AgentMessage[])
    : [];
  const workerLastAssistant =
    typeof msg['lastAssistant'] === 'string' ? msg['lastAssistant'] : null;

  return {
    newMessages,
    lastAssistant: resolveLastAssistant(newMessages, workerLastAssistant),
  };
}

/**
 * 根据最终助手消息解析可展示的助手文本。
 *
 * @param newMessages - Worker 本轮新增消息
 * @param workerLastAssistant - Worker 直接报告的最后助手文本
 * @returns 最终助手文本，无有效文本时返回 null
 */
function resolveLastAssistant(
  newMessages: readonly AgentMessage[],
  workerLastAssistant: string | null,
): string | null {
  const finalAssistant = findFinalAssistant(newMessages);
  if (!finalAssistant) return workerLastAssistant;

  const errorMessage = getAssistantErrorMessage(finalAssistant);
  if (errorMessage) return `[模型错误: ${errorMessage}]`;

  const text = extractAssistantText(finalAssistant).trim();
  return text.length > 0 ? text : null;
}

/**
 * 查找消息列表中最后一条 assistant 消息。
 *
 * @param messages - Agent 消息列表
 * @returns 最后一条 assistant 消息，未找到时返回 null
 */
function findFinalAssistant(messages: readonly AgentMessage[]): AgentMessage | null {
  for (const message of [...messages].reverse()) {
    if (message.role === 'assistant') return message;
  }
  return null;
}

/**
 * 读取 assistant 错误终止消息中的错误文本。
 *
 * @param message - Agent 消息
 * @returns 错误文本；非错误终止消息返回 null
 */
function getAssistantErrorMessage(message: AgentMessage): string | null {
  if (message.role !== 'assistant') return null;
  const record = message as unknown as Record<string, unknown>;
  if (record['stopReason'] !== 'error') return null;
  return typeof record['errorMessage'] === 'string' && record['errorMessage'].trim().length > 0
    ? record['errorMessage'].trim()
    : '模型调用失败但未返回错误详情';
}

/**
 * 提取 assistant 消息中的文本内容。
 *
 * @param message - Agent 消息
 * @returns 拼接后的文本内容
 */
function extractAssistantText(message: AgentMessage): string {
  if (message.role !== 'assistant') return '';
  return message.content
    .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
    .map((content) => content.text)
    .join('\n');
}

/**
 * 生成最终 assistant 消息的日志元信息。
 *
 * @param messages - Agent 消息列表
 * @returns 日志元信息
 */
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

/**
 * 按预算限制工具执行结果的内容长度。超出部分截断并在 details 中标记。
 *
 * @param result - 原始工具结果
 * @param budget - 内容预算
 * @returns 截断后的工具结果
 */
function limitToolResultContent<
  T extends { content: Array<{ type: 'text'; text: string }>; details: unknown },
>(result: T, budget: { maxToolResultTokens: number; maxToolResultChars: number }): T {
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
      ...(typeof result.details === 'object' &&
      result.details !== null &&
      !Array.isArray(result.details)
        ? result.details
        : {}),
      truncated: true,
      originalContentLength,
      truncatedContentLength,
      maxToolResultTokens: budget.maxToolResultTokens,
    },
  };
}
