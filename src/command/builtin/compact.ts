import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/session';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import { Agent } from '@aesyclaw/agent/agent';
import { serializeSessionKey } from '@aesyclaw/core/types';

export function createCompactCommand(
  sessionManager: Pick<SessionManager, 'get'>,
  llmAdapter: LlmAdapter,
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>,
  databaseManager: Pick<DatabaseManager, 'roleBindings' | 'sessions'>,
): CommandDefinition {
  return {
    name: 'compact',
    description: '压缩当前会话历史以减少上下文长度',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      const session = sessionManager.get(context.sessionKey);
      if (!session) {
        return '没有找到活跃会话。';
      }

      const activeRoleId = await resolveActiveRoleId(context, databaseManager);
      const role = activeRoleId ? roleManager.getRole(activeRoleId) : roleManager.getDefaultRole();

      const summary = await session.compact(llmAdapter, role.model);
      return `会话已压缩完成。\n${summary}`;
    },
  };
}

async function resolveActiveRoleId(
  context: CommandContext,
  databaseManager: Pick<DatabaseManager, 'roleBindings' | 'sessions'>,
): Promise<string | undefined> {
  const agent = Agent.activeAgents.get(serializeSessionKey(context.sessionKey));
  if (agent?.roleId) return agent.roleId;

  const session = await databaseManager.sessions.findByKey(context.sessionKey);
  if (!session) return undefined;

  return (await databaseManager.roleBindings.getActiveRole(session.id)) ?? undefined;
}
