import type { CommandDefinition, CommandContext, Message } from '@aesyclaw/core/types';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import { Agent } from '@aesyclaw/agent/agent';

/** role 子命令所需的依赖集合 */
export type RoleCommandDeps = {
  roleManager: Pick<RoleManager, 'getEnabledRoles' | 'getRole'>;
  databaseManager: Pick<DatabaseManager, 'sessions'>;
  agentRegistry: AgentRegistry;
};

/**
 * 创建 /role list 命令，列出所有已启用的角色。
 * @param deps - 角色命令依赖
 * @returns 命令定义
 */
export function createRoleListCommand(deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'list',
    namespace: 'role',
    description: '列出所有已启用的角色',
    usage: '/role list',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<Message> => {
      const roles = deps.roleManager.getEnabledRoles();

      if (roles.length === 0) {
        return { components: [{ type: 'Plain', text: '当前没有可用角色。' }] };
      }

      const activeRoleId = await Agent.resolveActiveRoleId(context, deps);
      const lines = roles.map((role) => {
        const current = role.id === activeRoleId ? '（当前）' : '';
        return `- ${role.id} — ${role.description}${current}`;
      });

      return { components: [{ type: 'Plain', text: lines.join('\n') }] };
    },
  };
}

/**
 * 创建 /role switch <id> 命令，切换当前会话的角色。
 * @param deps - 角色命令依赖
 * @returns 命令定义
 */
export function createRoleSwitchCommand(deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'switch',
    namespace: 'role',
    description: '切换当前角色',
    usage: '/role switch <id>',
    scope: 'system',
    execute: async (args: string[], context: CommandContext): Promise<Message> => {
      const roleId = args[0];
      if (!roleId) {
        return { components: [{ type: 'Plain', text: '用法：/role switch <id>' }] };
      }

      const targetRole = deps.roleManager.getEnabledRoles().find((role) => role.id === roleId);
      if (!targetRole) {
        return { components: [{ type: 'Plain', text: `未找到可用角色：${roleId}` }] };
      }

      const session = await deps.databaseManager.sessions.findByKey(context.sessionKey);
      if (session) {
        await deps.databaseManager.sessions.setRole(session.id, roleId);
      }

      const agent = deps.agentRegistry.getAgent(context.sessionKey);
      if (agent) {
        await agent.setRole(targetRole);
      }

      return { components: [{ type: 'Plain', text: `已切换到角色：${targetRole.id}` }] };
    },
  };
}

/**
 * 创建 /role info 命令，显示当前会话的角色信息。
 * @param deps - 角色命令依赖
 * @returns 命令定义
 */
export function createRoleInfoCommand(deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'info',
    namespace: 'role',
    description: '显示当前角色信息',
    usage: '/role info',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<Message> => {
      const activeRoleId = await Agent.resolveActiveRoleId(context, deps);
      if (!activeRoleId) {
        return { components: [{ type: 'Plain', text: '当前没有活跃角色。' }] };
      }
      const role = deps.roleManager.getRole(activeRoleId);
      return {
        components: [
          {
            type: 'Plain',
            text: [`当前角色：${role.id}`, `描述：${role.description}`, `模型：${role.model}`].join(
              '\n',
            ),
          },
        ],
      };
    },
  };
}
