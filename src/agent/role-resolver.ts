/**
 * role-resolver — 活跃角色解析器。
 *
 * 从 Agent 类中提取 resolveActiveRoleId 逻辑，
 * 使得 Pipeline 无需引用 Agent 类即可解析活跃角色。
 */

import type { CommandContext } from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';

export type RoleResolver = {
  resolveActiveRoleId(
    context: CommandContext,
    deps: {
      databaseManager: Pick<DatabaseManager, 'roleBindings' | 'sessions'>;
      agentRegistry: AgentRegistry;
    },
  ): Promise<string | undefined>;
};

export function createRoleResolver(): RoleResolver {
  return {
    resolveActiveRoleId: async (context, deps) => {
      const agent = deps.agentRegistry.getAgent(context.sessionKey);
      if (agent?.roleId) return agent.roleId;

      const session = await deps.databaseManager.sessions.findByKey(context.sessionKey);
      if (!session) return undefined;

      return (await deps.databaseManager.roleBindings.getActiveRole(session.id)) ?? undefined;
    },
  };
}
