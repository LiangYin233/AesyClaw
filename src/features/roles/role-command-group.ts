import type { CommandContext, CommandDefinition, CommandResult } from '@/contracts/commands.js';
import { roleManager } from './role-manager.js';
import { logger } from '@/platform/observability/logger.js';

interface RoleCommandSession {
  switchRole: (_roleId: string) => { success: boolean; message: string };
  getRoleInfo: () => {
    roleId: string;
    roleName: string;
    allowedTools: string[];
  };
}

export interface RoleCommandGroupDeps {
  getSessionForCommand: (_ctx: CommandContext) => RoleCommandSession | null;
}

export function createRoleCommandGroup(deps: RoleCommandGroupDeps): CommandDefinition[] {
  return [
    {
      name: 'role',
      description: '角色管理命令',
      usage: '/role <list|info|switch|current> [args...]',
      category: 'system',
      aliases: ['roles'],
      execute: async (ctx: CommandContext): Promise<CommandResult> => {
        const subCommand = ctx.args[0]?.toLowerCase();

        switch (subCommand) {
          case 'list': {
            const roles = roleManager.getRolesList();
            let output = '可用角色列表：\n\n';

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

            let output = `角色详情: **${role.name}**\n\n`;
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

            const session = deps.getSessionForCommand(ctx);
            if (!session) {
              return {
                success: false,
                message: '会话不存在',
              };
            }

            const result = session.switchRole(targetRoleId);

            return {
              success: result.success,
              message: result.message,
            };
          }

          case 'current': {
            const session = deps.getSessionForCommand(ctx);
            if (!session) {
              return {
                success: false,
                message: '会话不存在',
              };
            }

            const roleInfo = session.getRoleInfo();
            let output = `当前角色: **${roleInfo.roleName}**\n\n`;
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
}
