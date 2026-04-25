/**
 * CommandDetectorMiddleware — detects and executes slash commands.
 *
 * If the inbound message content starts with "/" and matches a registered
 * command, this middleware executes it and sets the outbound response.
 * Command handling is terminal — it does NOT call next(), so subsequent
 * middlewares (like AgentProcessor) are skipped.
 *
 */

import type { PipelineState, NextFn } from './types';
import type { CommandRegistry } from '../../command/command-registry';
import type { CommandContext } from '../../core/types';

/**
 * Detects slash commands and executes them via CommandRegistry.
 *
 * Commands are user-facing features like /help, /role list, etc.
 * When a command is detected, this middleware:
 * 1. Creates a CommandContext from the pipeline state
 * 2. Executes the command via CommandRegistry
 * 3. Sets the outbound response on the state
 * 4. Returns the state WITHOUT calling next() — commands are terminal
 */
export class CommandDetectorMiddleware {
  readonly name = 'CommandDetector';

  constructor(private commandRegistry: CommandRegistry) {}

  async execute(state: PipelineState, next: NextFn): Promise<PipelineState> {
    if (this.commandRegistry.isCommand(state.inbound.content)) {
      const commandContext: CommandContext = {
        sessionKey: state.inbound.sessionKey,
      };

      const result = await this.commandRegistry.execute(state.inbound.content, commandContext);

      if (result !== null) {
        state.outbound = { content: result };
      } else {
        state.outbound = { content: 'Unknown command' };
      }

      // Command handling is terminal — don't call next()
      return state;
    }

    // Not a command — continue the middleware chain
    return next(state);
  }
}
