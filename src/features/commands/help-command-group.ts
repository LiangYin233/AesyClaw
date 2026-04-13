import type { CommandContext, CommandDefinition, CommandResult } from '@/contracts/commands.js';
import { commandRegistry } from './command-registry.js';

export const helpCommandGroup: CommandDefinition[] = [
  {
    name: 'help',
    description: '显示帮助信息',
    usage: '/help [command]',
    category: 'system',
    execute: async (ctx: CommandContext): Promise<CommandResult> => {
      const targetCommand = ctx.args[0]?.toLowerCase();

      if (targetCommand) {
        const command = commandRegistry.getCommand(targetCommand);
        if (!command) {
          return {
            success: false,
            message: `未找到命令: /${targetCommand}`,
          };
        }

        return {
          success: true,
          message: `/${command.name}\n\n${command.description}\n\n使用方法: ${command.usage}`,
        };
      }

      const systemCmds = commandRegistry.getSystemCommands();
      const pluginCmds = commandRegistry.getPluginCommands();

      let output = '可用命令列表\n\n';

      output += '系统命令\n';
      for (const cmd of systemCmds) {
        if (cmd.name !== 'help') {
          output += `  /${cmd.name} - ${cmd.description}\n`;
        }
      }

      if (pluginCmds.length > 0) {
        output += '\n插件命令\n';
        for (const cmd of pluginCmds) {
          const displayName = cmd.name.replace(/^[^:]+:/, '');
          output += `  /${displayName} - ${cmd.description}\n`;
        }
      }

      output += '\n\n输入 /help <command> 查看详细用法';

      return {
        success: true,
        message: output,
      };
    },
  },
];
