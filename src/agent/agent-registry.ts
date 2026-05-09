import type { Worker } from 'node:worker_threads';
import type { SessionKey } from '@aesyclaw/core/types';
import { serializeSessionKey } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { Agent } from './agent';

const logger = createScopedLogger('agent-registry');

/**
 * Agent 注册中心，管理 Agent 实例和 Worker 线程的生命周期。
 */
export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();
  private readonly workers = new Map<string, { worker: Worker; sessionKeyId: string }>();

  /**
   * 注册 Agent 实例。
   *
   * @param sessionKey - 会话标识
   * @param agent - Agent 实例
   */
  registerAgent(sessionKey: SessionKey, agent: Agent): void {
    this.agents.set(serializeSessionKey(sessionKey), agent);
  }

  /**
   * 获取已注册的 Agent 实例。
   *
   * @param sessionKey - 会话标识
   * @returns 对应的 Agent 实例，未注册时返回 undefined
   */
  getAgent(sessionKey: SessionKey): Agent | undefined {
    return this.agents.get(serializeSessionKey(sessionKey));
  }

  /**
   * 注册 Worker 线程，关联到指定的 runId 和会话。
   *
   * @param runId - 运行标识
   * @param worker - Worker 线程实例
   * @param sessionKey - 会话标识
   */
  registerWorker(runId: string, worker: Worker, sessionKey: SessionKey): void {
    this.workers.set(runId, { worker, sessionKeyId: serializeSessionKey(sessionKey) });
  }

  /**
   * 取消注册 Worker 线程。仅当 runId 和 worker 实例匹配时才移除。
   *
   * @param runId - 运行标识
   * @param worker - Worker 线程实例
   */
  unregisterWorker(runId: string, worker: Worker): void {
    const entry = this.workers.get(runId);
    if (entry?.worker === worker) {
      this.workers.delete(runId);
    }
  }

  /**
   * 取消指定会话下的所有 Worker 线程。
   *
   * @param sessionKey - 会话标识
   * @returns 如果有 Worker 被取消则返回 true
   */
  cancel(sessionKey: SessionKey): boolean {
    const cancelledWorkers = this.cancelWorkersForSession(sessionKey);
    if (cancelledWorkers === 0) return false;
    logger.info('Agent 已被 /stop 命令中止', { sessionKey, cancelledWorkers });
    return true;
  }

  /**
   * 终止指定会话下的所有 Worker 线程。
   *
   * @param sessionKey - 会话标识
   * @returns 被取消的 Worker 数量
   */
  private cancelWorkersForSession(sessionKey: SessionKey): number {
    const serialized = serializeSessionKey(sessionKey);
    let cancelled = 0;

    for (const [runId, entry] of this.workers) {
      if (entry.sessionKeyId !== serialized) continue;
      this.workers.delete(runId);
      void entry.worker.terminate();
      cancelled += 1;
    }

    if (cancelled > 0) {
      logger.info('Agent worker 已取消', { sessionKey, cancelledWorkers: cancelled });
    }

    return cancelled;
  }
}