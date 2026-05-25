/**
 * 内置 help 命令。
 *
 * 列出所有已注册的命令及其名称和描述。
 *
 */

import type { CommandDefinition, CommandContext, Message } from '@aesyclaw/core/types';

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
    allowDuringAgentProcessing: true,
    execute: async (_args: string[], _context: CommandContext): Promise<Message> => {
      const commands = getAllCommands();

      if (commands.length === 0) {
        return { components: [{ type: 'Plain', text: '没有注册任何命令。' }] };
      }

      const lines: string[] = [];

      // 按 namespace 分组；无 namespace 的扩展命令按 scope 来源分
      const groups = new Map<string, CommandDefinition[]>();
      for (const cmd of commands) {
        let key = cmd.namespace;
        if (!key) {
          if (cmd.scope === 'system') {
            key = '_root';
          } else if (cmd.scope?.startsWith('channel:')) {
            key = cmd.scope.slice(8); // 'channel:weixin' → 'weixin'
          } else if (cmd.scope?.startsWith('plugin:')) {
            key = cmd.scope.slice(7); // 'plugin:example' → 'example'
          } else {
            key = cmd.scope ?? '其他';
          }
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(cmd);
      }

      // 排序：_root（内置）在前，按字母
      const sortedKeys = [...groups.keys()].sort((a, b) => {
        if (a === '_root') return -1;
        if (b === '_root') return 1;
        return a.localeCompare(b);
      });

      for (const key of sortedKeys) {
        const cmds = groups.get(key)!;
        if (key === '_root') {
          lines.push('## 内置');
        } else {
          lines.push(`## ${key}`);
        }
        for (const cmd of cmds.sort((a, b) => a.name.localeCompare(b.name))) {
          const cmdText = cmd.namespace ? `/${cmd.namespace} ${cmd.name}` : `/${cmd.name}`;
          lines.push(`- \`${cmdText}\` — ${cmd.description}`);
        }
        lines.push('');
      }

      return { components: [{ type: 'Plain', text: lines.join('\n').trim() }] };
    },
  };
}
