/**
 * 会话解析 — 解析或创建会话上下文。
 *
 * 为入站消息的 SessionKey 查找或创建 SessionContext，
 * 然后将其附加到管道状态，供
 * 后续步骤使用（如 Agent 处理）。
 */

import type { PipelineState } from './types';
import type { SessionManager } from '../../agent/session-manager';

/**
 * 解析入站消息的会话上下文。
 *
 * 如果不存在会话，则创建一个（包括数据库记录、角色
 * 绑定、内存和 Agent）。生成的 SessionContext 被
 * 放置到 `state.session` 上。
 */
export async function sessionResolver(
  state: PipelineState,
  sessionManager: SessionManager,
): Promise<PipelineState> {
  if (isCronContextRun(state.inbound.sessionKey, state.inbound.rawEvent)) {
    await sessionManager.resetSession(state.inbound.sessionKey);
  }

  state.session = await sessionManager.getOrCreateSession(state.inbound.sessionKey);
  return state;
}

function isCronContextRun(
  sessionKey: { channel: string; type: string },
  value: unknown,
): value is { cronJobId: string; cronRunId: string } {
  if (sessionKey.channel !== 'cron' || sessionKey.type !== 'job') {
    return false;
  }

  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).cronJobId === 'string' &&
    typeof (value as Record<string, unknown>).cronRunId === 'string'
  );
}
