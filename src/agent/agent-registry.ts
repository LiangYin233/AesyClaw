import type { Worker } from 'node:worker_threads';
import type { SessionKey } from '@aesyclaw/core/types';
import { serializeSessionKey } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { Agent } from './agent';

const logger = createScopedLogger('agent-registry');

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();
  private readonly workers = new Map<string, { worker: Worker; sessionKeyId: string }>();

  registerAgent(sessionKey: SessionKey, agent: Agent): void {
    this.agents.set(serializeSessionKey(sessionKey), agent);
  }

  getAgent(sessionKey: SessionKey): Agent | undefined {
    return this.agents.get(serializeSessionKey(sessionKey));
  }

  registerWorker(runId: string, worker: Worker, sessionKey: SessionKey): void {
    this.workers.set(runId, { worker, sessionKeyId: serializeSessionKey(sessionKey) });
  }

  unregisterWorker(runId: string, worker: Worker): void {
    const entry = this.workers.get(runId);
    if (entry?.worker === worker) {
      this.workers.delete(runId);
    }
  }

  cancel(sessionKey: SessionKey): boolean {
    const cancelledWorkers = this.cancelWorkersForSession(sessionKey);
    if (cancelledWorkers === 0) return false;
    logger.info('Agent 已被 /stop 命令中止', { sessionKey, cancelledWorkers });
    return true;
  }

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