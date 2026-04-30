/**
 * 内置 help 命令。
 *
 * 列出所有已注册的命令及其名称和描述。
 *
 */

import type { CommandDefinition, CommandContext } from '../../core/types';

/**
 * 创建 help 命令定义。
 *
 * @param getAllCommands - 返回所有已注册命令的函数
 * @returns help 命令的 CommandDefinition
 */
export function createHelpCommand(getAllCommands: () => CommandDefinition[]): CommandDefinition {
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
          const commandText =
            cmd.usage ?? `/${cmd.namespace ? `${cmd.namespace} ${cmd.name}` : cmd.name}`;
          return `  ${commandText}  ${cmd.description}`;
        });

      return `可用命令：\n${lines.join('\n')}`;
    },
  };
}
