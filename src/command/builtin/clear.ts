/**
 * Built-in clear command.
 *
 * Clears session history.
 *
 */

import type { CommandDefinition, CommandContext } from '../../core/types';
import type { SessionManager } from '../../agent/session-manager';

export interface ClearCommandDeps {
  sessionManager: Pick<SessionManager, 'clearSession'>;
}

export function createClearCommand(deps: ClearCommandDeps): CommandDefinition {
  return {
    name: 'clear',
    description: '清除当前会话历史',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      await deps.sessionManager.clearSession(context.sessionKey);
      return '当前会话历史已清除。';
    },
  };
}
