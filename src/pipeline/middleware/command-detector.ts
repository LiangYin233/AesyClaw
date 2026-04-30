/**
 * Command Detection — detects and executes slash commands.
 *
 * If the inbound message content starts with "/" and matches a registered
 * command, this step executes it and sets the outbound response.
 * Command handling is terminal — when an outbound is set, the pipeline
 * skips subsequent steps (like agent processing).
 */

import type { PipelineState } from './types';
import type { CommandRegistry } from '../../command/command-registry';
import type { CommandContext } from '../../core/types';
import {
  AGENT_PROCESSING_BUSY_MESSAGE,
  type SessionManager,
} from '../../agent/session-manager';

/**
 * Detects slash commands and executes them via CommandRegistry.
 *
 * Commands are user-facing features like /help, /role list, etc.
 * When a command is detected, this function:
 * 1. Creates a CommandContext from the pipeline state
 * 2. Executes the command via CommandRegistry
 * 3. Sets the outbound response on the state
 * 4. Returns the state — the pipeline should skip remaining steps
 */
export async function commandDetector(
  state: PipelineState,
  commandRegistry: CommandRegistry,
  sessionManager: Pick<SessionManager, 'isAgentProcessing'>,
): Promise<PipelineState> {
  const resolved = commandRegistry.resolve(state.inbound.content);
  const isBusy = sessionManager.isAgentProcessing(state.inbound.sessionKey);

  if (isBusy && (!resolved || !resolved.command.allowDuringAgentProcessing)) {
    state.outbound = { content: AGENT_PROCESSING_BUSY_MESSAGE };
    return state;
  }

  if (!resolved) {
    return state;
  }

  const commandContext: CommandContext = {
    sessionKey: state.inbound.sessionKey,
  };

  const result = await commandRegistry.executeResolved(resolved, commandContext);
  state.outbound = { content: result };

  return state;
}
