/**
 * Built-in clear command.
 *
 * Clears session history. Stub until SessionManager is implemented.
 *
 * @see project.md §5.9
 */

import type { CommandDefinition, CommandContext } from '../../core/types';

export function createClearCommand(): CommandDefinition {
  return {
    name: 'clear',
    description: '清除当前会话历史',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<string> => {
      // Stub — depends on SessionManager
      return 'Session clear not yet implemented.';
    },
  };
}