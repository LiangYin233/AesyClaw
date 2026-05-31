import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import { defineCommand } from '@aesyclaw/command/command-builder';
import type { CommandContext, Message } from '@aesyclaw/core/types';
import { Agent } from '@aesyclaw/agent/agent';
import type { BuiltinCommandDependencies } from './builtin-types';

export function registerRoleBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  registry.register(defineCommand({
    name: 'list',
    namespace: 'role',
    description: '列出所有可用角色',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (): Promise<Message> => {
      const roles = deps.roleManager.getAllRoles();
      if (roles.length === 0) {
        return { components: [{ type: 'Plain', text: '没有可用的角色。' }] };
      }

      const lines = ['可用角色：\n'];
      const defaultRoleId = deps.roleManager.getDefaultRole().id;
      for (const role of roles) {
        const marker = role.id === defaultRoleId ? ' (默认)' : '';
        lines.push(`  ${role.id}${marker} - ${role.description}`);
      }

      return { components: [{ type: 'Plain', text: lines.join('\n') }] };
    },
  }));

  registry.register(defineCommand({
    name: 'switch',
    namespace: 'role',
    description: '切换当前会话的角色',
    usage: '/role:switch <role-id>',
    scope: 'system',
    allowDuringAgentProcessing: false,
    execute: async (args: string[], context: CommandContext): Promise<Message> => {
      const roleId = args.join(' ').trim();
      if (roleId.length === 0) {
        return { components: [{ type: 'Plain', text: '用法：/role:switch <role-id>' }] };
      }

      const role = deps.roleManager.getRole(roleId);
      if (role === undefined) {
        return { components: [{ type: 'Plain', text: `角色不存在：${roleId}` }] };
      }

      const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
      if (dbRecord === null) {
        return { components: [{ type: 'Plain', text: '会话不存在' }] };
      }
      await deps.databaseManager.sessions.setRole(dbRecord.id, roleId);

      const agent = deps.agentRegistry.getAgent(context.sessionKey);
      if (agent !== undefined && agent !== null) {
        await agent.setRole(role);
      }

      return { components: [{ type: 'Plain', text: `已切换到角色：${role.id}` }] };
    },
  }));

  registry.register(defineCommand({
    name: 'info',
    namespace: 'role',
    description: '查看当前会话的角色信息',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (_args: string[], context: CommandContext): Promise<Message> => {
      const activeRoleId = await Agent.resolveActiveRoleId(context, {
        databaseManager: deps.databaseManager,
        agentRegistry: deps.agentRegistry,
      });
      const role = activeRoleId !== undefined
        ? deps.roleManager.getRole(activeRoleId)
        : deps.roleManager.getDefaultRole();

      const lines = [
        `当前角色：${role.id}`,
        ...(role.description.length > 0 ? [`描述：${role.description}`] : []),
      ];

      return { components: [{ type: 'Plain', text: lines.join('\n') }] };
    },
  }));
}
