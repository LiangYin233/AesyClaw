import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { extractMessageText, type AgentMessage, type ResolvedModel, type AgentTool } from './agent-types';
import type { AgentRegistry } from './agent-registry';
import type { SessionKey } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('worker-runner');
const WORKER_PATH = fileURLToPath(new URL('./runner/agent-worker.ts', import.meta.url));

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

export type WorkerRunResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
};

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

function normalizeWorkerDoneMessage(msg: Record<string, unknown>): WorkerRunResult {
  const newMessages = Array.isArray(msg['newMessages']) ? (msg['newMessages'] as AgentMessage[]) : [];
  const workerLastAssistant = typeof msg['lastAssistant'] === 'string' ? msg['lastAssistant'] : null;

  return {
    newMessages,
    lastAssistant: resolveLastAssistant(newMessages, workerLastAssistant),
  };
}

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

function estimateApproximateTokens(messages: readonly AgentMessage[]): number {
  const textLength = messages.reduce((total, message) => total + extractMessageText(message).length, 0);
  return estimateApproximateTokensFromTextLength(textLength);
}

function estimateApproximateTokensFromText(text: string): number {
  return estimateApproximateTokensFromTextLength(text.length);
}

function estimateApproximateTokensFromTextLength(textLength: number): number {
  return Math.ceil(textLength / 4);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
