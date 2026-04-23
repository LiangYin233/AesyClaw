/**
 * SessionResolverMiddleware — resolves or creates a session context.
 *
 * This is a stub implementation that will be completed when
 * SessionManager is implemented. For now, it simply passes
 * the state through to the next middleware.
 *
 * @see project.md §5.5
 */

import type { PipelineState, NextFn } from './types';

/**
 * Resolves the session context for the inbound message.
 *
 * Stub — depends on SessionManager which is not yet implemented.
 * When SessionManager is available, this middleware will:
 *   state.session = await this.sessionManager.getOrCreateSession(state.inbound.sessionKey);
 */
export class SessionResolverMiddleware {
  readonly name = 'SessionResolver';

  constructor(
    // Will be typed as SessionManager when implemented
    private _sessionManager: unknown,
  ) {}

  async execute(state: PipelineState, next: NextFn): Promise<PipelineState> {
    // TODO: Implement with real SessionManager
    // state.session = await this.sessionManager.getOrCreateSession(state.inbound.sessionKey);
    return next(state);
  }
}
