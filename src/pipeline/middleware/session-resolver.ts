/**
 * Session Resolution — resolves or creates a session context.
 *
 * Looks up or creates a SessionContext for the inbound message's
 * SessionKey, then attaches it to the pipeline state for use by
 * subsequent steps (e.g., agent processing).
 */

import type { PipelineState } from './types';
import type { SessionManager } from '../../agent/session-manager';

/**
 * Resolves the session context for the inbound message.
 *
 * If no session exists, one is created (including DB record, role
 * binding, memory, and agent). The resulting SessionContext is
 * placed on `state.session`.
 */
export async function sessionResolver(
  state: PipelineState,
  sessionManager: SessionManager,
): Promise<PipelineState> {
  state.session = await sessionManager.getOrCreateSession(state.inbound.sessionKey);
  return state;
}
