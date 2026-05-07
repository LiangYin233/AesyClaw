import type { SessionManager } from '@aesyclaw/session';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import type { CommandContext, CommandDefinition } from '@aesyclaw/core/types';
import type { RoleConfig } from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import { getMessageText } from '@aesyclaw/core/types';
import { Agent } from '@aesyclaw/agent/agent';
import { serializeSessionKey } from '@aesyclaw/core/types';

export function createBtwCommand(
  sessionManager: Pick<SessionManager, 'create'>,
  getRoleOrFallback: (roleId: string) => RoleConfig,
  getDefaultRole: () => RoleConfig,
  llmAdapter: LlmAdapter,
  roleManager: RoleManager,
  skillManager: SkillManager,
  toolRegistry: ToolRegistry,
  hookDispatcher: HookDispatcher,
  databaseManager: Pick<DatabaseManager, 'roleBindings' | 'sessions'>,
  compressionThreshold: number,
): CommandDefinition {
  return {
    name: 'btw',
    description: '在当前会话上下文中执行一次独立提问',
    usage: '/btw <message>',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (args: string[], context: CommandContext): Promise<string> => {
      const content = args.join(' ').trim();
      if (!content) {
        return '用法：/btw <message>';
      }

      const session = await sessionManager.create(context.sessionKey);

      const activeRoleId = await resolveActiveRoleId(context, databaseManager);
      const role = activeRoleId ? getRoleOrFallback(activeRoleId) : getDefaultRole();

      const agent = new Agent({
        session,
        llmAdapter,
        roleManager,
        skillManager,
        toolRegistry,
        hookDispatcher,
        compressionThreshold,
      });
      const outbound = await agent.processEphemeral(role, content);

      return getMessageText(outbound);
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
