import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/session';
import type { AgentRegistry } from '@aesyclaw/agent/registry';

/**
 * 创建 /clear 命令，用于清除当前会话历史；/clear delete 删除当前会话。
 * @param sessionManager - 会话管理器（需 clear / delete 方法）
 * @param agentRegistry - Agent 注册表，用于删除会话后清理 Agent 缓存
 * @returns 命令定义
 */
export function createClearCommand(
  sessionManager: Pick<SessionManager, 'clear' | 'delete'>,
  agentRegistry: Pick<AgentRegistry, 'unregisterAgent'>,
): CommandDefinition {
  return {
    name: 'clear',
    description: '清除当前会话历史；使用 /clear delete 删除当前会话',
    scope: 'system',
    execute: async (args: string[], context: CommandContext): Promise<string> => {
      if (args[0]?.toLowerCase() === 'delete') {
        const deleted = await sessionManager.delete(context.sessionKey);
        agentRegistry.unregisterAgent(context.sessionKey);
        return deleted ? '当前会话已删除。' : '当前会话不存在或已被删除。';
      }

      await sessionManager.clear(context.sessionKey);
      return '当前会话历史已清除。';
    },
  };
}
