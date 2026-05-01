/**
 * Agent 处理 — 通过 AI Agent 处理入站消息。
 *
 * 使用上一步（sessionResolver）的 SessionContext
 * 通过 AgentEngine 处理入站消息。生成的出站
 * 消息被放置到管道状态中。
 */

import type { PipelineState } from './types';
import type { AgentEngine } from '../../agent/agent-engine';
import {
  AGENT_PROCESSING_BUSY_MESSAGE,
  type SessionContext,
  type SessionManager,
} from '../../agent/session-manager';
import type { HookDispatcher } from '../hook-dispatcher';

/**
 * 通过 AI Agent 处理入站消息。
 *
 * 期望 `state.session` 为 SessionContext（由 sessionResolver 设置）。
 * 处理后，使用 Agent 的响应设置 `state.outbound`。
 */
export async function agentProcessor(
  state: PipelineState,
  agentEngine: AgentEngine,
  hookDispatcher: HookDispatcher,
  sessionManager: Pick<SessionManager, 'tryBeginAgentProcessing' | 'endAgentProcessing' | 'isAgentProcessing'>,
): Promise<PipelineState> {
  const session: SessionContext | undefined = state.session;

  if (!session) {
    // 无会话上下文 — 跳过 Agent 处理
    state.outbound = { content: '[错误: 无可用会话上下文]' };
    return state;
  }

  if (!sessionManager.tryBeginAgentProcessing(session.key)) {
    state.outbound = { content: AGENT_PROCESSING_BUSY_MESSAGE };
    return state;
  }

  try {
    const beforeResult = await hookDispatcher.dispatchBeforeLLMRequest({
      message: state.inbound,
      session,
      agent: session.agent,
      role: session.activeRole,
    });

    if (beforeResult.action === 'block') {
      state.blocked = true;
      state.blockReason = beforeResult.reason ?? 'Blocked by beforeLLMRequest hook';
      return state;
    }

    if (beforeResult.action === 'respond') {
      state.outbound = { content: beforeResult.content };
      return state;
    }

    const outbound = await agentEngine.process(
      session.agent,
      state.inbound,
      session.memory,
      session.activeRole,
      state.sendMessage,
    );

    if (!sessionManager.isAgentProcessing(session.key)) {
      return state;
    }

    state.outbound = outbound;
  } finally {
    sessionManager.endAgentProcessing(session.key);
  }

  return state;
}
