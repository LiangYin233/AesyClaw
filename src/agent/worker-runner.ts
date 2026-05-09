import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { extractMessageText, type AgentMessage, type ResolvedModel, type AgentTool } from './agent-types';
import type { AgentRegistry } from './agent-registry';
import type { SessionKey } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('worker-runner');
const WORKER_PATH = fileURLToPath(new URL('./runner/agent-worker.ts', import.meta.url));

/**
 * Worker 任务的输入参数。
 */
export type WorkerRunParams = {
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

/**
 * Worker 任务的返回结果。
 */
export type WorkerRunResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
};

/**
 * 在独立 Worker 线程中执行 LLM 代理任务。
 *
 * @param params - Worker 运行参数
 * @returns Worker 运行结果
 */
export function runWorkerTask(params: WorkerRunParams): Promise<WorkerRunResult> {
  const { roleId, model, prompt, tools, history, content, sessionKey, compressionThreshold, registry } =
    params;
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolResultBudget = calculateToolResultBudget(model, compressionThreshold, history, content);
  const worker = new Worker(WORKER_PATH);
  const runId = randomUUID();
  registry.registerWorker(runId, worker, sessionKey);
  const runRegistry = registry;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onMessage: ((msg: any) => void) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onError: ((err: any) => void) | undefined;
  let onExit: ((code: number) => void) | undefined;
  let settled = false;

  return new Promise<WorkerRunResult>((resolve, reject) => {
    onError = (err: Error) => {
      settled = true;
      cleanup();
      reject(new Error(`Worker 错误: ${err.message}`));
    };
    onExit = (code: number) => {
      if (settled || code === 0) return;
      settled = true;
      cleanup();
      reject(new Error('Agent 处理已中止'));
    };
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    onMessage = async (msg: Record<string, unknown>) => {
      if (msg['type'] === 'done') {
        settled = true;
        const result = normalizeWorkerDoneMessage(msg);
        const lastAssistantMeta = getFinalAssistantMeta(result.newMessages);
        logger.info('Agent 处理已完成', { sessionKey, role: roleId, runId, ...lastAssistantMeta });
        cleanup();
        resolve(result);
      } else if (msg['type'] === 'toolCall') {
        const tool = toolMap.get(msg['toolName'] as string);
        if (!tool) {
          worker.postMessage({
            type: 'toolResult',
            callId: msg['callId'],
            error: `工具 "${msg['toolName'] as string}" 未找到`,
          });
          return;
        }
        try {
          const toolResult = await tool.execute(msg['toolCallId'] as string, msg['params']);
          if (toolResult.isError) {
            const errorContent =
              typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content);
            logger.error('工具调用返回错误', { toolName: msg['toolName'], error: errorContent });
            worker.postMessage({
              type: 'toolResult',
              callId: msg['callId'],
              error: errorContent,
              isError: true,
            });
          } else {
            const limitedToolResult = limitToolResultContent(toolResult, toolResultBudget);
            worker.postMessage({
              type: 'toolResult',
              callId: msg['callId'],
              result: limitedToolResult,
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('工具调用执行失败', { toolName: msg['toolName'], error: errMsg });
          worker.postMessage({
            type: 'toolResult',
            callId: msg['callId'],
            error: errMsg,
          });
        }
      } else if (msg['type'] === 'fatal') {
        settled = true;
        cleanup();
        reject(new Error(msg['message'] as string));
      }
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);

    worker.postMessage({
      type: 'init',
      systemPrompt: prompt,
      model,
      apiKey: model.apiKey,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      history,
      content,
      extraBody: model.extraBody,
      sessionId: `worker:${roleId}:${runId}`,
    });
  }).finally(() => {
    cleanup();
  });

  function cleanup(): void {
    if (onMessage) worker.off('message', onMessage);
    if (onError) worker.off('error', onError);
    if (onExit) worker.off('exit', onExit);
    runRegistry.unregisterWorker(runId, worker);
    void worker.terminate();
  }
}

/**
 * 规范化 Worker 的 done 消息为 WorkerRunResult。
 *
 * @param msg - Worker 发回的 done 消息
 * @returns 规范化后的运行结果
 */
function normalizeWorkerDoneMessage(msg: Record<string, unknown>): WorkerRunResult {
  const newMessages = Array.isArray(msg['newMessages']) ? (msg['newMessages'] as AgentMessage[]) : [];
  const workerLastAssistant = typeof msg['lastAssistant'] === 'string' ? msg['lastAssistant'] : null;

  return {
    newMessages,
    lastAssistant: resolveLastAssistant(newMessages, workerLastAssistant),
  };
}

/**
 * 解析最后一条助手消息的文本，处理错误和空文本情况。
 *
 * @param newMessages - 新增的消息列表
 * @param workerLastAssistant - Worker 报告的 lastAssistant 文本
 * @returns 解析后的助手文本，无有效文本时返回 null
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
 * 从消息列表中查找最后一条 assistant 消息。
 *
 * @param messages - 消息数组
 * @returns 最后一条 assistant 消息，未找到返回 null
 */
function findFinalAssistant(messages: readonly AgentMessage[]): AgentMessage | null {
  for (const message of [...messages].reverse()) {
    if (message.role === 'assistant') return message;
  }
  return null;
}

/**
 * 从助手消息中提取错误信息。
 *
 * @param message - 助手消息
 * @returns 错误消息文本，非错误消息返回 null
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
 * 从助手消息中提取纯文本内容。
 *
 * @param message - 助手消息
 * @returns 拼接后的文本字符串
 */
function extractAssistantText(message: AgentMessage): string {
  if (message.role !== 'assistant') return '';
  return message.content
    .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
    .map((content) => content.text)
    .join('\n');
}

/**
 * 获取最终助手消息的元信息用于日志记录。
 *
 * @param messages - 消息数组
 * @returns 包含角色、停止原因、错误消息和文本长度的元信息对象
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
 * 计算工具调用结果的内容预算，基于模型上下文窗口和压缩阈值。
 *
 * @param model - 已解析的模型配置
 * @param compressionThreshold - 压缩阈值比例
 * @param history - 历史消息
 * @param content - 当前用户输入
 * @returns 最大工具结果 tokens 和字符数
 */
function calculateToolResultBudget(
  model: ResolvedModel,
  compressionThreshold: number,
  history: readonly AgentMessage[],
  content: string,
): { maxToolResultTokens: number; maxToolResultChars: number } {
  const compressionLimitTokens = Math.floor(model.contextWindow * compressionThreshold);
  const usedTokens = estimateApproximateTokens(history) + estimateApproximateTokensFromText(content);
  const remainingTokens = Math.max(0, compressionLimitTokens - usedTokens);
  const maxToolResultTokens = Math.floor(remainingTokens * 0.5);

  return {
    maxToolResultTokens,
    maxToolResultChars: maxToolResultTokens * 4,
  };
}

/**
 * 按预算限制工具执行结果的内容长度。超出部分截断并在 details 中标记。
 *
 * @param result - 原始工具结果
 * @param budget - 内容预算
 * @returns 截断后的工具结果
 */
function limitToolResultContent<T extends { content: Array<{ type: 'text'; text: string }>; details: unknown }>(
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
      ...(isRecord(result.details) ? result.details : {}),
      truncated: true,
      originalContentLength,
      truncatedContentLength,
      maxToolResultTokens: budget.maxToolResultTokens,
    },
  };
}

/**
 * 估算消息数组的近似 token 数。
 *
 * @param messages - 消息数组
 * @returns 近似 token 数
 */
function estimateApproximateTokens(messages: readonly AgentMessage[]): number {
  const textLength = messages.reduce((total, message) => total + extractMessageText(message).length, 0);
  return estimateApproximateTokensFromTextLength(textLength);
}

/**
 * 根据文本内容估算 token 数。
 *
 * @param text - 文本内容
 * @returns 近似 token 数
 */
function estimateApproximateTokensFromText(text: string): number {
  return estimateApproximateTokensFromTextLength(text.length);
}

/**
 * 根据文本长度估算 token 数（粗略按每 4 字符 ≈ 1 token 计算）。
 *
 * @param textLength - 文本字符数
 * @returns 近似 token 数
 */
function estimateApproximateTokensFromTextLength(textLength: number): number {
  return Math.ceil(textLength / 4);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
