import { CommandDefinition, CommandContext, CommandResult } from './types.js';
import { commandRegistry } from './command-registry.js';
import { AgentManager } from '../../agent/core/engine.js';
import { logger } from '../../platform/observability/logger.js';
import { pluginManager } from '../plugins/plugin-manager.js';
import { roleManager } from '../roles/role-manager.js';
import { MemoryManagerFactory } from '../../agent/core/memory/session-memory-manager.js';

function formatPluginList(): string {
  const plugins = commandRegistry.getPluginCommands();
  const loadedPlugins = pluginManager.getLoadedPlugins();

  if (plugins.length === 0) {
    return '暂无已加载的插件命令。';
  }

  let output = '🔌 插件状态：\n\n';
  const pluginMap = new Map<string, { loaded: boolean; commands: string[] }>();

  for (const cmd of plugins) {
    const parts = cmd.name.split(':');
    const pluginName = parts[0];
    if (!pluginMap.has(pluginName)) {
      pluginMap.set(pluginName, { loaded: true, commands: [] });
    }
    pluginMap.get(pluginName)!.commands.push(
      `  /${cmd.name.replace(/^[^:]+:/, '')} - ${cmd.description}`
    );
  }

  for (const [pluginName, info] of pluginMap) {
    const status = info.loaded ? '✅' : '❌';
    output += `${status} ${pluginName}\n`;
    output += info.commands.join('\n');
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

          logger.info({ pluginName }, '正在开启插件');
          const result = await pluginManager.enablePlugin(pluginName);
          return {
            success: result.success,
            message: result.message,
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

          logger.info({ pluginName }, '正在关闭插件');
          const result = await pluginManager.disablePlugin(pluginName);
          return {
            success: result.success,
            message: result.message,
          };
        }

        default: {
          return {
            success: false,
            message: `未知子命令: ${subCommand || '(无)'}\n\n可用子命令:\n  /plugin list     - 列出所有插件\n  /plugin enable   - 开启插件\n  /plugin disable  - 关闭插件`,
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
  {
    name: 'role',
    description: '角色管理命令',
    usage: '/role <list|info|switch> [args...]',
    category: 'system',
    aliases: ['roles'],
    execute: async (ctx: CommandContext): Promise<CommandResult> => {
      const subCommand = ctx.args[0]?.toLowerCase();

      switch (subCommand) {
        case 'list': {
          const roles = roleManager.getRolesList();
          let output = '🎭 可用角色列表：\n\n';

          const memoryFactory = MemoryManagerFactory.getInstance();
          const currentMemory = memoryFactory.getOrCreate(ctx.chatId);
          const currentRoleId = currentMemory.getActiveRoleId();

          for (const role of roles) {
            const marker = role.id === currentRoleId ? '👉 ' : '  ';
            const tags = role.tags.length > 0 ? ` [${role.tags.join(', ')}]` : '';
            output += `${marker}**${role.name}**${tags}\n`;
            if (role.description) {
              output += `    ${role.description}\n`;
            }
          }

          output += '\n使用 /role info <role-id> 查看角色详情';
          output += '\n使用 /role switch <role-id> 切换角色';

          return {
            success: true,
            message: output,
          };
        }

        case 'info': {
          const roleId = ctx.args[1];
          if (!roleId) {
            return {
              success: false,
              message: '请指定角色ID\n\n用法: /role info <role-id>',
            };
          }

          const role = roleManager.getRole(roleId);
          if (!role) {
            return {
              success: false,
              message: `角色 "${roleId}" 不存在\n\n使用 /role list 查看所有可用角色`,
            };
          }

          let output = `🎭 角色详情: **${role.name}**\n\n`;
          output += `**ID**: \`${role.metadata.id}\`\n`;
          if (role.description) {
            output += `**描述**: ${role.description}\n`;
          }
          output += '\n**可用工具**: ';
          if (role.allowed_tools.includes('*')) {
            output += '所有工具\n';
          } else {
            output += role.allowed_tools.length > 0
              ? role.allowed_tools.join(', ') + '\n'
              : '无限制\n';
          }
          output += '\n**可用技能**: ';
          if (role.allowed_skills.length > 0) {
            output += role.allowed_skills.join(', ') + '\n';
          } else {
            output += '无限制\n';
          }
          if (role.override_model) {
            output += `\n**模型**: ${role.override_model}\n`;
          }
          if (role.tags.length > 0) {
            output += `\n**标签**: ${role.tags.join(', ')}\n`;
          }

          return {
            success: true,
            message: output,
          };
        }

        case 'switch': {
          const targetRoleId = ctx.args[1];
          if (!targetRoleId) {
            return {
              success: false,
              message: '请指定要切换的角色ID\n\n用法: /role switch <role-id>',
            };
          }

          logger.info({ targetRoleId, chatId: ctx.chatId }, '正在切换角色');

          const memoryFactory = MemoryManagerFactory.getInstance();
          const currentMemory = memoryFactory.getOrCreate(ctx.chatId);
          const result = await currentMemory.switchRole(targetRoleId);

          if (result.success) {
            const role = roleManager.getRole(targetRoleId);
            if (role?.override_model) {
              const agentManager = AgentManager.getInstance();
              const agent = agentManager.getOrCreate(ctx.chatId);
              agent.updateModel(role.override_model);
            }
          }

          return {
            success: result.success,
            message: result.message,
          };
        }

        case 'current': {
          const memoryFactory = MemoryManagerFactory.getInstance();
          const currentMemory = memoryFactory.getOrCreate(ctx.chatId);
          const roleInfo = currentMemory.getRoleInfo();

          const role = roleManager.getRole(roleInfo.roleId);
          let output = `🎭 当前角色: **${roleInfo.roleName}**\n\n`;
          output += `**ID**: \`${roleInfo.roleId}\`\n`;
          output += '\n**可用工具**: ';
          if (roleInfo.allowedTools.includes('*')) {
            output += '所有工具\n';
          } else {
            output += roleInfo.allowedTools.length > 0
              ? roleInfo.allowedTools.join(', ') + '\n'
              : '无\n';
          }

          return {
            success: true,
            message: output,
          };
        }

        default: {
          return {
            success: false,
            message: `未知子命令: ${subCommand || '(无)'}\n\n可用子命令:\n  /role list     - 列出所有角色\n  /role info     - 查看角色详情\n  /role switch   - 切换角色\n  /role current  - 查看当前角色`,
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
