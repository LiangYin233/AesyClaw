import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/session';

export function createClearCommand(
  sessionManager: Pick<SessionManager, 'clear'>,
): CommandDefinition {
  return {
    name: 'clear',
    description: '清除当前会话历史',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      await sessionManager.clear(context.sessionKey);
      return '当前会话历史已清除。';
    },
  };
}
