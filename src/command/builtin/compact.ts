/**
 * Built-in compact command.
 *
 * Compacts session history to reduce context size. Stub until
 * AgentEngine is implemented.
 *
 * @see project.md §5.9
 */

import type { CommandDefinition, CommandContext } from '../../core/types';

export function createCompactCommand(): CommandDefinition {
  return {
    name: 'compact',
    description: '压缩当前会话历史以减少上下文长度',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<string> => {
      // Stub — depends on AgentEngine
      return 'Session compact not yet implemented.';
    },
  };
}