/**
 * Built-in help command.
 *
 * Lists all registered commands with their name and description.
 *
 */

import type { CommandDefinition, CommandContext } from '../../core/types';

export function createHelpCommand(
  getAllCommands: () => CommandDefinition[],
): CommandDefinition {
  return {
    name: 'help',
    description: '列出所有可用命令',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<string> => {
      const commands = getAllCommands();

      if (commands.length === 0) {
        return '没有注册任何命令。';
      }

      const lines = commands
        .sort((a, b) => {
          const keyA = a.namespace ? `${a.namespace}:${a.name}` : a.name;
          const keyB = b.namespace ? `${b.namespace}:${b.name}` : b.name;
          return keyA.localeCompare(keyB);
        })
        .map((cmd) => {
          const key = cmd.namespace ? `${cmd.namespace}:${cmd.name}` : cmd.name;
          const usage = cmd.usage ? ` — ${cmd.usage}` : '';
          return `  /${key}${usage}  ${cmd.description}`;
        });

      return `可用命令：\n${lines.join('\n')}`;
    },
  };
}
