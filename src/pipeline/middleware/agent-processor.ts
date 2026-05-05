/**
 * Agent 处理 — 通过 AI Agent 处理入站消息。
 *
 * 使用上一步的 Session 和 Agent 处理入站消息。
 * 生成的出站消息被放置到管道状态中。
 */

import type { PipelineState } from './types';
import { AGENT_PROCESSING_BUSY_MESSAGE } from '@aesyclaw/agent/session';

export async function agentProcessor(state: PipelineState): Promise<PipelineState> {
  if (state.stage !== 'continue' || !state.session) {
    if (state.stage === 'continue') {
      return {
        ...state,
        stage: 'respond',
        outbound: { components: [{ type: 'Plain', text: '[错误: 无可用会话上下文]' }] },
      };
    }
    return state;
  }

  const session = state.session;

  if (!session.lock()) {
    return {
      ...state,
      stage: 'respond',
      outbound: { components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }] },
    };
  }

  try {
    if (!state.activeRole || !state.agent) {
      return {
        ...state,
        stage: 'respond',
        outbound: { components: [{ type: 'Plain', text: '[错误: 无可用角色]' }] },
      };
    }

    const outbound = await state.agent.process(state.inbound, state.sendMessage);

    if (!session.isLocked) {
      return state;
    }

    return { ...state, stage: 'respond', outbound };
  } finally {
    session.unlock();
  }
}
