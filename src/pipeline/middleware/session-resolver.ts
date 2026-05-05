/**
 * 会话解析 — 解析或创建会话。
 *
 * 为入站消息的 SessionKey 查找或创建 Session，
 * 然后将其附加到管道状态，供
 * 后续步骤使用（如 Agent 处理）。
 */

import type { PipelineState } from './types';
import type { SessionManager } from '@aesyclaw/agent/session/manager';

/**
 * 解析入站消息的会话。
 *
 * 如果不存在会话，则创建一个（包括数据库记录）。
 * 生成的 Session 被放置到 `state.session` 上。
 */
export async function sessionResolver(
  state: PipelineState,
  sessionManager: SessionManager,
): Promise<PipelineState> {
  if (state.stage !== 'continue') {
    return state;
  }

  if (state.sessionKey.channel === 'cron' && state.sessionKey.type === 'job') {
    const existing = sessionManager.get(state.sessionKey);
    if (existing) await existing.clear();
  }

  return { ...state, session: await sessionManager.create(state.sessionKey) };
}
