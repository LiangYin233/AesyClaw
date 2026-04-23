/**
 * AgentProcessorMiddleware — calls the AI agent to process the message.
 *
 * This is a stub implementation that will be completed when
 * AgentEngine is implemented. For now, it produces a placeholder
 * outbound response and passes the state through.
 *
 * @see project.md §5.5
 */

import type { PipelineState, NextFn } from './types';

/**
 * Processes the inbound message through the AI agent.
 *
 * Stub — depends on AgentEngine which is not yet implemented.
 * When AgentEngine is available, this middleware will:
 *   const outbound = await this.agentEngine.process(state.session, state.inbound);
 *   state.outbound = outbound;
 */
export class AgentProcessorMiddleware {
  readonly name = 'AgentProcessor';

  constructor(
    // Will be typed as AgentEngine when implemented
    private _agentEngine: unknown,
  ) {}

  async execute(state: PipelineState, next: NextFn): Promise<PipelineState> {
    // TODO: Implement with real AgentEngine
    // const outbound = await this.agentEngine.process(state.session, state.inbound);
    // state.outbound = outbound;
    state.outbound = { content: '[Agent processing not yet implemented]' };
    return next(state);
  }
}
