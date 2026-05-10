import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import {
  calculateToolResultBudget,
  createInitMessage,
  handleWorkerMessage,
  type WorkerRunParams,
  type WorkerRunResult,
} from './agent-worker-protocol';
import type { WorkerToHostMessage } from './agent-worker-ipc';

export type { WorkerRunParams, WorkerRunResult } from './agent-worker-protocol';

const WORKER_ENTRY_PATH = fileURLToPath(new URL('./agent-worker-entry.ts', import.meta.url));

/**
 * 在独立 Worker 线程中执行 LLM 代理任务。
 *
 * @param params - Worker 运行参数
 * @returns Worker 运行结果
 */
export function runWorkerTask(params: WorkerRunParams): Promise<WorkerRunResult> {
  const { roleId, model, tools, history, content, sessionKey, compressionThreshold, registry } =
    params;
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolResultBudget = calculateToolResultBudget(model, compressionThreshold, history, content);
  const worker = new Worker(WORKER_ENTRY_PATH);
  const runId = randomUUID();
  registry.registerWorker(runId, worker, sessionKey);

  let settled = false;

  return new Promise<WorkerRunResult>((resolve, reject) => {
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      registry.unregisterWorker(runId, worker);
      void worker.terminate();
    };

    const onError = (err: Error): void => {
      settled = true;
      cleanup();
      reject(new Error(`Worker 错误: ${err.message}`));
    };

    const onExit = (code: number): void => {
      if (settled || code === 0) return;
      settled = true;
      cleanup();
      reject(new Error('Agent 处理已中止'));
    };

    const onMessage = (msg: WorkerToHostMessage): void => {
      void handleWorkerMessage(
        {
          worker,
          toolMap,
          toolResultBudget,
          roleId,
          runId,
          sessionKey,
          markSettled: () => {
            settled = true;
          },
          cleanup,
        },
        { resolve, reject },
        msg,
      );
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);

    worker.postMessage(createInitMessage(params, runId));
  });
}
