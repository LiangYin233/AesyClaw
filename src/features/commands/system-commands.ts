import { CommandDefinition, CommandContext, CommandResult } from './types.js';
import { commandRegistry } from './command-registry.js';
import { AgentManager } from '../../agent/core/engine.js';
import { logger } from '../../platform/observability/logger.js';

function formatPluginList(): string {
  const plugins = commandRegistry.getPluginCommands();
  if (plugins.length === 0) {
    return '暂无已加载的插件命令。';
  }

  let output = '🔌 已加载的插件命令：\n\n';
  const pluginMap = new Map<string, string[]>();

  for (const cmd of plugins) {
    const parts = cmd.name.split(':');
    const pluginName = parts[0];
    if (!pluginMap.has(pluginName)) {
      pluginMap.set(pluginName, []);
    }
    pluginMap.get(pluginName)!.push(`  /${cmd.name.replace(/^[^:]+:/, '')} - ${cmd.description}`);
  }

  for (const [pluginName, commands] of pluginMap) {
    output += `📦 ${pluginName}\n`;
    output += commands.join('\n');
    output += '\n\n';
  }

  return output.trim();
}

export const systemCommands: CommandDefinition[] = [
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
          message: `📖 /${command.name}\n\n${command.description}\n\n使用方法: ${command.usage}`,
        };
      }

      const systemCmds = commandRegistry.getSystemCommands();
      const pluginCmds = commandRegistry.getPluginCommands();

      let output = '📚 可用命令列表\n\n';

      output += '📦 系统命令\n';
      for (const cmd of systemCmds) {
        if (cmd.name !== 'help') {
          output += `  /${cmd.name} - ${cmd.description}\n`;
        }
      }

      if (pluginCmds.length > 0) {
        output += '\n🔌 插件命令\n';
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
  {
    name: 'plugin',
    description: '插件管理命令',
    usage: '/plugin <list|enable|disable> [args...]',
    category: 'system',
    aliases: ['plugins'],
    execute: async (ctx: CommandContext): Promise<CommandResult> => {
      const subCommand = ctx.args[0]?.toLowerCase();

      switch (subCommand) {
        case 'list': {
          const plugins = commandRegistry.getPluginCommands();
          return {
            success: true,
            message: formatPluginList(),
          };
        }

        case 'enable': {
          const pluginName = ctx.args[1];
          if (!pluginName) {
            return {
              success: false,
              message: '请指定要开启的插件名称\n\n用法: /plugin enable <plugin-name>',
            };
          }

          logger.info({ pluginName }, '插件开启命令（需要配置支持）');
          return {
            success: false,
            message: `插件动态开启功能暂未实现。\n\n当前已加载的插件命令：\n${formatPluginList()}`,
          };
        }

        case 'disable': {
          const pluginName = ctx.args[1];
          if (!pluginName) {
            return {
              success: false,
              message: '请指定要关闭的插件名称\n\n用法: /plugin disable <plugin-name>',
            };
          }

          logger.info({ pluginName }, '插件关闭命令（需要配置支持）');
          return {
            success: false,
            message: `插件动态关闭功能暂未实现。\n\n当前已加载的插件命令：\n${formatPluginList()}`,
          };
        }

        default: {
          return {
            success: false,
            message: `未知子命令: ${subCommand || '(无)'}\n\n可用子命令:\n  /plugin list     - 列出所有插件命令\n  /plugin enable   - 开启插件（暂未实现）\n  /plugin disable  - 关闭插件（暂未实现）`,
          };
        }
      }
    },
  },
  {
    name: 'session',
    description: '会话管理命令',
    usage: '/session <new|clear>',
    category: 'system',
    aliases: ['sess'],
    execute: async (ctx: CommandContext): Promise<CommandResult> => {
      const subCommand = ctx.args[0]?.toLowerCase();

      switch (subCommand) {
        case 'new': {
          const newChatId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          const agentManager = AgentManager.getInstance();
          agentManager.getOrCreate(newChatId);

          return {
            success: true,
            message: `✅ 新会话已创建\n\n会话ID: ${newChatId}\n\n请使用此会话ID开始新对话。`,
            data: { newChatId },
          };
        }

        case 'clear': {
          const agentManager = AgentManager.getInstance();
          const agent = agentManager.getOrCreate(ctx.chatId);
          agent.clearHistory();

          return {
            success: true,
            message: '✅ 会话历史已清除',
          };
        }

        default: {
          return {
            success: false,
            message: `未知子命令: ${subCommand || '(无)'}\n\n可用子命令:\n  /session new   - 创建新会话\n  /session clear - 清除当前会话历史`,
          };
        }
      }
    },
  },
];

export function registerSystemCommands(): void {
  for (const command of systemCommands) {
    commandRegistry.register(command);
  }
  logger.info({ count: systemCommands.length }, '✅ 系统命令已注册');
}
