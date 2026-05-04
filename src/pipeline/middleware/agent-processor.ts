/**
 * Agent 处理 — 通过 AI Agent 处理入站消息。
 *
 * 使用上一步（sessionResolver）的 SessionContext
 * 通过 AgentEngine 处理入站消息。生成的出站
 * 消息被放置到管道状态中。
 *
 * 注意：beforeLLMRequest 钩子由 Pipeline 在调用此处理器之前统一调度，
 * 因此本处理器不再接收 hookDispatcher，专注于纯粹的 Agent 执行。
 */

import type { PipelineState } from './types';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import {
  AGENT_PROCESSING_BUSY_MESSAGE,
  type SessionContext,
  type SessionManager,
} from '@aesyclaw/agent/session-manager';

/**
 * 通过 AI Agent 处理入站消息。
 *
 * 期望 `state.session` 为 SessionContext（由 sessionResolver 设置）。
 * 处理后，使用 Agent 的响应设置 `state.outbound`。
 *
 * @param state - 当前管道状态（已由 Pipeline 调度 beforeLLMRequest 钩子）
 * @param agentEngine - Agent 引擎
 * @param sessionManager - 会话管理器
 * @returns 更新后的管道状态
 */
export async function agentProcessor(
  state: PipelineState,
  agentEngine: AgentEngine,
  sessionManager: Pick<
    SessionManager,
    'tryBeginAgentProcessing' | 'endAgentProcessing' | 'isAgentProcessing'
  >,
): Promise<PipelineState> {
  if (state.stage !== 'continue') {
    return state;
  }

  const session: SessionContext | undefined = state.session;

  if (!session) {
    return {
      ...state,
      stage: 'respond',
      outbound: { components: [{ type: 'Plain', text: '[错误: 无可用会话上下文]' }] },
    };
  }

  if (!sessionManager.tryBeginAgentProcessing(session.key)) {
    return {
      ...state,
      stage: 'respond',
      outbound: { components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }] },
    };
  }

  try {
    const outbound = await agentEngine.process(
      state.inbound,
      state.sessionKey,
      session.memory,
      session.activeRole,
      state.sendMessage,
    );

    if (!sessionManager.isAgentProcessing(session.key)) {
      return state;
    }

    return { ...state, stage: 'respond', outbound };
  } finally {
    sessionManager.endAgentProcessing(session.key);
  }
}
