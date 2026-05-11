import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/session';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';
import { Agent } from '@aesyclaw/agent/agent';

/**
 * 创建 /compact 命令，使用 LLM 压缩当前会话历史为摘要。
 * @param sessionManager - 会话管理器（仅需 get 方法）
 * @param llmAdapter - LLM 适配器
 * @param roleManager - 角色管理器（仅需 getRole 和 getDefaultRole）
 * @param databaseManager - 数据库管理器（仅需 roleBindings 和 sessions）
 * @param agentRegistry - Agent 注册表
 * @returns 命令定义
 */
export function createCompactCommand(
  sessionManager: Pick<SessionManager, 'get'>,
  llmAdapter: LlmAdapter,
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>,
  databaseManager: Pick<DatabaseManager, 'roleBindings' | 'sessions'>,
  agentRegistry: AgentRegistry,
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

      const activeRoleId = await Agent.resolveActiveRoleId(context, {
        databaseManager,
        agentRegistry,
      });
      const role = activeRoleId ? roleManager.getRole(activeRoleId) : roleManager.getDefaultRole();

      const summary = await session.compact(llmAdapter, role.model);
      return `会话已压缩完成。\n${summary}`;
    },
  };
}
