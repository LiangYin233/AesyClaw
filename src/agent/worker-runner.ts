import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { AgentMessage, ResolvedModel, AgentTool } from './agent-types';
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
  registry: AgentRegistry;
};

export type WorkerRunResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
};

export function runWorkerTask(params: WorkerRunParams): Promise<WorkerRunResult> {
  const { roleId, model, prompt, tools, history, content, sessionKey, registry } = params;
  const toolMap = new Map(tools.map((t) => [t.name, t]));
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
        logger.info('Agent 处理已完成', { sessionKey, role: roleId, runId });
        cleanup();
        resolve({
          newMessages: msg['newMessages'] as AgentMessage[],
          lastAssistant: msg['lastAssistant'] as string | null,
        });
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
            worker.postMessage({
              type: 'toolResult',
              callId: msg['callId'],
              result: toolResult,
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