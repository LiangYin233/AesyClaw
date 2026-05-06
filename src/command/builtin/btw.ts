import type { SessionManager } from '@aesyclaw/agent/session/manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { CommandContext, CommandDefinition } from '@aesyclaw/core/types';
import type { RoleConfig } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
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
  configManager: ConfigManager,
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
        ? getRoleOrFallback(session.activeRoleId)
        : getDefaultRole();

      const agent = new Agent({
        session,
        llmAdapter,
        roleManager,
        skillManager,
        toolRegistry,
        hookDispatcher,
        configManager,
      });
      const outbound = await agent.processEphemeral(role, content);

      return getMessageText(outbound);
    },
  };
}
