/**
 * 内置角色管理命令。
 *
 * 子命令：
 *   /role list   — 列出所有已启用的角色
 *   /role switch — 切换当前角色
 *   /role info   — 显示当前角色信息
 *
 */

import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session-manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';

export type RoleCommandDeps = {
  roleManager: Pick<RoleManager, 'getEnabledRoles' | 'getRole'>;
  sessionManager: Pick<SessionManager, 'getOrCreateSession' | 'switchRole'>;
};

/**
 * 创建 role list 命令定义。
 *
 * @param deps - 包含 roleManager 和 sessionManager 的依赖项
 * @returns role list 命令的 CommandDefinition
 */
export function createRoleListCommand(deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'list',
    namespace: 'role',
    description: '列出所有已启用的角色',
    usage: '/role list',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      const session = await deps.sessionManager.getOrCreateSession(context.sessionKey);
      const roles = deps.roleManager.getEnabledRoles();

      if (roles.length === 0) {
        return '当前没有可用角色。';
      }

      const lines = roles.map((role) => {
        const current = role.id === session.activeRole.id ? '（当前）' : '';
        return `- ${role.id} — ${role.name}${current}`;
      });

      return `可用角色：\n${lines.join('\n')}`;
    },
  };
}

/**
 * 创建 role switch 命令定义。
 *
 * @param deps - 包含 roleManager 和 sessionManager 的依赖项
 * @returns role switch 命令的 CommandDefinition
 */
export function createRoleSwitchCommand(deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'switch',
    namespace: 'role',
    description: '切换当前角色',
    usage: '/role switch <id>',
    scope: 'system',
    execute: async (args: string[], context: CommandContext): Promise<string> => {
      const roleId = args[0];
      if (!roleId) {
        return '用法：/role switch <id>';
      }

      const targetRole = deps.roleManager.getEnabledRoles().find((role) => role.id === roleId);
      if (!targetRole) {
        return `未找到可用角色：${roleId}`;
      }

      await deps.sessionManager.switchRole(context.sessionKey, roleId);
      return `已切换到角色：${targetRole.id}（${targetRole.name}）`;
    },
  };
}

/**
 * 创建 role info 命令定义。
 *
 * @param deps - 包含 roleManager 和 sessionManager 的依赖项
 * @returns role info 命令的 CommandDefinition
 */
export function createRoleInfoCommand(deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'info',
    namespace: 'role',
    description: '显示当前角色信息',
    usage: '/role info',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      const session = await deps.sessionManager.getOrCreateSession(context.sessionKey);
      const role = deps.roleManager.getRole(session.activeRole.id);
      return [
        `当前角色：${role.id}`,
        `名称：${role.name}`,
        `描述：${role.description}`,
        `模型：${role.model}`,
      ].join('\n');
    },
  };
}
