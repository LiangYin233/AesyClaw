/**
 * AgentProcessorMiddleware — processes the inbound message through the AI agent.
 *
 * Uses the SessionContext from the previous middleware (SessionResolver)
 * to process the inbound message via AgentEngine. The resulting outbound
 * message is placed on the pipeline state.
 *
 * @see project.md §5.5
 */

import type { PipelineState, NextFn } from './types';
import type { AgentEngine } from '../../agent/agent-engine';
import type { SessionContext } from '../../agent/session-manager';

/**
 * Processes the inbound message through the AI agent.
 *
 * Expects `state.session` to be a SessionContext (set by SessionResolver).
 * After processing, sets `state.outbound` with the agent's response.
 */
export class AgentProcessorMiddleware {
  readonly name = 'AgentProcessor';

  constructor(private agentEngine: AgentEngine) {}

  async execute(state: PipelineState, next: NextFn): Promise<PipelineState> {
    const session = state.session as SessionContext | undefined;

    if (!session) {
      // No session context — skip agent processing
      state.outbound = { content: '[Error: No session context available]' };
      return next(state);
    }

    try {
      const outbound = await this.agentEngine.process(
        session.agent,
        state.inbound,
        session.memory,
        session.activeRole,
        state.sendMessage,
      );
      state.outbound = outbound;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.outbound = { content: `[Agent processing error: ${message}]` };
    }

    return next(state);
  }
}
