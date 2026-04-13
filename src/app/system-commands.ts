import { sessionRegistry } from '@/app/session-registry.js';
import { pluginManager } from '@/app/plugin-runtime.js';
import {
  CommandContext,
  CommandDefinition,
  CommandResult,
} from '@/contracts/commands.js';
import { commandRegistry } from '@/features/commands/command-registry.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { logger } from '@/platform/observability/logger.js';

function formatPluginList(): string {
  const plugins = commandRegistry.getPluginCommands();

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
    usage: '/session <list|clear|stats>',
    category: 'system',
    aliases: ['sess'],
    execute: async (ctx: CommandContext): Promise<CommandResult> => {
      const subCommand = ctx.args[0]?.toLowerCase();

      switch (subCommand) {
        case 'list': {
          const sessions = sessionRegistry.getAllSessions();
          if (sessions.length === 0) {
            return {
              success: true,
              message: '暂无活动会话',
            };
          }

          let output = '📋 活动会话列表：\n\n';
          for (const session of sessions) {
            const { channel, type, chatId, session: sessionPart } = session.metadata;
            output += `${channel}:${type}:${chatId}:${sessionPart}\n`;
            output += `  - 消息数: ${session.metadata.messageCount}\n`;
            output += `  - 最后活跃: ${session.metadata.lastActiveAt.toLocaleString()}\n\n`;
          }

          return {
            success: true,
            message: output.trim(),
          };
        }

        case 'clear': {
          const existingSessionId = sessionRegistry.getSessionIdByChatId(
            ctx.channelId,
            ctx.messageType,
            ctx.chatId
          );

          if (!existingSessionId) {
            const sessions = sessionRegistry.getSessionsByChatId(ctx.chatId);
            if (sessions.length === 0) {
              return {
                success: false,
                message: '会话不存在',
              };
            }
            sessions[0].memory.clear();
            return {
              success: true,
              message: '会话历史已清除',
            };
          }

          const session = sessionRegistry.getSession(existingSessionId);
          if (session) {
            session.memory.clear();
            return {
              success: true,
              message: '会话历史已清除',
            };
          }
          return {
            success: false,
            message: '会话不存在',
          };
        }

        case 'stats': {
          const stats = sessionRegistry.getStats();
          let output = ' 会话统计：\n\n';
          output += `总会话数: ${stats.total}\n\n`;
          output += '按渠道:\n';
          for (const [channel, count] of Object.entries(stats.byChannel)) {
            output += `  - ${channel}: ${count}\n`;
          }
          output += '\n按类型:\n';
          for (const [type, count] of Object.entries(stats.byType)) {
            output += `  - ${type}: ${count}\n`;
          }

          return {
            success: true,
            message: output.trim(),
          };
        }

        default: {
          return {
            success: false,
            message: `未知子命令: ${subCommand || '(无)'}\n\n可用子命令:\n  /session list   - 列出所有会话\n  /session clear - 清除当前会话\n  /session stats - 查看会话统计`,
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

          for (const role of roles) {
            output += `  **${role.name}**\n`;
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
              ? `${role.allowed_tools.join(', ')}\n`
              : '无限制\n';
          }
          output += '\n**可用技能**: ';
          if (role.allowed_skills.length > 0) {
            output += `${role.allowed_skills.join(', ')}\n`;
          } else {
            output += '无限制\n';
          }
          if (role.model) {
            output += `\n**模型**: ${role.model}\n`;
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

          const existingSessionId = sessionRegistry.getSessionIdByChatId(
            ctx.channelId,
            ctx.messageType,
            ctx.chatId
          );

          let session;
          if (existingSessionId) {
            session = sessionRegistry.getSession(existingSessionId);
          } else {
            const sessions = sessionRegistry.getSessionsByChatId(ctx.chatId);
            session = sessions.length > 0 ? sessions[0] : null;
          }

          if (!session) {
            return {
              success: false,
              message: '会话不存在',
            };
          }

          const result = await session.memory.switchRole(targetRoleId);

          if (result.success) {
            const role = roleManager.getRole(targetRoleId);
            if (role?.model) {
              session.agent.updateModel(role.model);
            }
          }

          return {
            success: result.success,
            message: result.message,
          };
        }

        case 'current': {
          const existingSessionId = sessionRegistry.getSessionIdByChatId(
            ctx.channelId,
            ctx.messageType,
            ctx.chatId
          );

          let session;
          if (existingSessionId) {
            session = sessionRegistry.getSession(existingSessionId);
          } else {
            const sessions = sessionRegistry.getSessionsByChatId(ctx.chatId);
            session = sessions.length > 0 ? sessions[0] : null;
          }

          if (!session) {
            return {
              success: false,
              message: '会话不存在',
            };
          }

          const roleInfo = session.memory.getRoleInfo();
          let output = `🎭 当前角色: **${roleInfo.roleName}**\n\n`;
          output += `**ID**: \`${roleInfo.roleId}\`\n`;
          output += '\n**可用工具**: ';
          if (roleInfo.allowedTools.includes('*')) {
            output += '所有工具\n';
          } else {
            output += roleInfo.allowedTools.length > 0
              ? `${roleInfo.allowedTools.join(', ')}\n`
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
  logger.info({ count: systemCommands.length }, '系统命令已注册');
}
