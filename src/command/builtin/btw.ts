import type { SessionManager } from '@aesyclaw/session';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import type { CommandContext, CommandDefinition, RoleConfig } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';
import { Agent } from '@aesyclaw/agent/agent';

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
  agentRegistry: AgentRegistry,
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

      const activeRoleId = await resolveActiveRoleId(context, databaseManager, agentRegistry);
      const role = activeRoleId ? getRoleOrFallback(activeRoleId) : getDefaultRole();

      const agent = new Agent({
        session,
        llmAdapter,
        roleManager,
        skillManager,
        toolRegistry,
        hookDispatcher,
        compressionThreshold,
        registry: agentRegistry,
      });
      const outbound = await agent.process(
        { components: [{ type: 'Plain', text: content }] },
        undefined,
        { ephemeral: true, role },
      );

      return getMessageText(outbound);
    },
  };
}

async function resolveActiveRoleId(
  context: CommandContext,
  databaseManager: Pick<DatabaseManager, 'roleBindings' | 'sessions'>,
  agentRegistry: AgentRegistry,
): Promise<string | undefined> {
  const agent = agentRegistry.getAgent(context.sessionKey);
  if (agent?.roleId) return agent.roleId;

  const session = await databaseManager.sessions.findByKey(context.sessionKey);
  if (!session) return undefined;

  return (await databaseManager.roleBindings.getActiveRole(session.id)) ?? undefined;
}