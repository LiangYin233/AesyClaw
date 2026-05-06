import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session/manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';

export type RoleCommandDeps = {
  roleManager: Pick<RoleManager, 'getEnabledRoles' | 'getRole'>;
  sessionManager: Pick<SessionManager, 'create' | 'setActiveRole'>;
};

export function createRoleListCommand(deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'list',
    namespace: 'role',
    description: '列出所有已启用的角色',
    usage: '/role list',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      const session = await deps.sessionManager.create(context.sessionKey);
      const roles = deps.roleManager.getEnabledRoles();

      if (roles.length === 0) {
        return '当前没有可用角色。';
      }

      const lines = roles.map((role) => {
        const current = role.id === session.activeRoleId ? '（当前）' : '';
        return `- ${role.id} — ${role.description}${current}`;
      });

      return `可用角色：\n${lines.join('\n')}`;
    },
  };
}

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

      await deps.sessionManager.setActiveRole(context.sessionKey, roleId);
      return `已切换到角色：${targetRole.id}`;
    },
  };
}

export function createRoleInfoCommand(deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'info',
    namespace: 'role',
    description: '显示当前角色信息',
    usage: '/role info',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      const session = await deps.sessionManager.create(context.sessionKey);
      const roleId = session.activeRoleId;
      if (!roleId) {
        return '当前没有活跃角色。';
      }
      const role = deps.roleManager.getRole(roleId);
      return [
        `当前角色：${role.id}`,
        `描述：${role.description}`,
        `描述：${role.description}`,
        `模型：${role.model}`,
      ].join('\n');
    },
  };
}
