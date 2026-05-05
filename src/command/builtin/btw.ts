import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import type { SessionManager } from '@aesyclaw/agent/session/manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { CommandContext, CommandDefinition } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';

export function createBtwCommand(
  sessionManager: Pick<SessionManager, 'create'>,
  agentEngine: Pick<AgentEngine, 'processEphemeral'>,
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>,
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
      const role = session.activeRoleId
        ? roleManager.getRole(session.activeRoleId)
        : roleManager.getDefaultRole();

      const outbound = await agentEngine.processEphemeral(session, role, content);

      return getMessageText(outbound);
    },
  };
}
