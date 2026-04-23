/**
 * SessionResolverMiddleware — resolves or creates a session context.
 *
 * Looks up or creates a SessionContext for the inbound message's
 * SessionKey, then attaches it to the pipeline state for use by
 * subsequent middlewares (e.g. AgentProcessor).
 *
 * @see project.md §5.5
 */

import type { PipelineState, NextFn } from './types';
import type { SessionManager } from '../../agent/session-manager';

/**
 * Resolves the session context for the inbound message.
 *
 * If no session exists, one is created (including DB record, role
 * binding, memory, and agent). The resulting SessionContext is
 * placed on `state.session`.
 */
export class SessionResolverMiddleware {
  readonly name = 'SessionResolver';

  constructor(private sessionManager: SessionManager) {}

  async execute(state: PipelineState, next: NextFn): Promise<PipelineState> {
    state.session = await this.sessionManager.getOrCreateSession(state.inbound.sessionKey);
    return next(state);
  }
}