import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session/manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { RoleManager } from '@aesyclaw/role/role-manager';

export function createCompactCommand(
  sessionManager: Pick<SessionManager, 'get'>,
  llmAdapter: LlmAdapter,
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>,
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
      const role = session.activeRoleId
        ? roleManager.getRole(session.activeRoleId)
        : roleManager.getDefaultRole();
      const summary = await session.compact(llmAdapter, role.model);
      return `会话已压缩完成。\n${summary}`;
    },
  };
}
