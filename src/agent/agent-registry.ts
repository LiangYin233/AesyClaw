import type { SessionKey } from '@aesyclaw/core/types';
import { serializeSessionKey } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { Agent } from './agent';

const logger = createScopedLogger('agent-registry');

export type AgentRunHandle = {
  cancel: () => void;
};

/**
 * Agent 注册中心，管理 Agent 实例和运行任务的生命周期。
 */
export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();
  private readonly runs = new Map<string, { run: AgentRunHandle; sessionKeyId: string }>();

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
   * 注册 Agent 运行，关联到指定的 runId 和会话。
   *
   * @param runId - 运行标识
   * @param run - 可取消的 Agent 运行句柄
   * @param sessionKey - 会话标识
   */
  registerRun(runId: string, run: AgentRunHandle, sessionKey: SessionKey): void {
    this.runs.set(runId, { run, sessionKeyId: serializeSessionKey(sessionKey) });
  }

  /**
   * 取消注册 Agent 运行。仅当 runId 和运行句柄匹配时才移除。
   *
   * @param runId - 运行标识
   * @param run - Agent 运行句柄
   */
  unregisterRun(runId: string, run: AgentRunHandle): void {
    const entry = this.runs.get(runId);
    if (entry?.run === run) {
      this.runs.delete(runId);
    }
  }

  /**
   * 取消指定会话下的所有 Agent 运行。
   *
   * @param sessionKey - 会话标识
   * @returns 如果有运行任务被取消则返回 true
   */
  cancel(sessionKey: SessionKey): boolean {
    const cancelledRuns = this.cancelRunsForSession(sessionKey);
    if (cancelledRuns === 0) return false;
    logger.info('Agent 已被 /stop 命令中止', { sessionKey, cancelledRuns });
    return true;
  }

  /**
   * 取消指定会话下的所有 Agent 运行。
   *
   * @param sessionKey - 会话标识
   * @returns 被取消的运行数量
   */
  private cancelRunsForSession(sessionKey: SessionKey): number {
    const serialized = serializeSessionKey(sessionKey);
    let cancelled = 0;

    for (const [runId, entry] of this.runs) {
      if (entry.sessionKeyId !== serialized) continue;
      this.runs.delete(runId);
      entry.run.cancel();
      cancelled += 1;
    }

    if (cancelled > 0) {
      logger.info('Agent 运行已取消', { sessionKey, cancelledRuns: cancelled });
    }

    return cancelled;
  }
}
