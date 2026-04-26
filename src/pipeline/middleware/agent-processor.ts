/**
 * Agent Processing — processes the inbound message through the AI agent.
 *
 * Uses the SessionContext from the previous step (sessionResolver)
 * to process the inbound message via AgentEngine. The resulting outbound
 * message is placed on the pipeline state.
 */

import type { PipelineState } from './types';
import type { AgentEngine } from '../../agent/agent-engine';
import type { SessionContext } from '../../agent/session-manager';
import type { HookDispatcher } from '../hook-dispatcher';

/**
 * Processes the inbound message through the AI agent.
 *
 * Expects `state.session` to be a SessionContext (set by sessionResolver).
 * After processing, sets `state.outbound` with the agent's response.
 */
export async function agentProcessor(
  state: PipelineState,
  agentEngine: AgentEngine,
  hookDispatcher: HookDispatcher,
): Promise<PipelineState> {
  const session: SessionContext | undefined = state.session;

  if (!session) {
    // No session context — skip agent processing
    state.outbound = { content: '[Error: No session context available]' };
    return state;
  }

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
  state.outbound = outbound;

  return state;
}
