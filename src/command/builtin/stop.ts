import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/session';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';

/**
 * 创建 /stop 命令，用于中止当前正在进行的 Agent 处理。
 * @param sessionManager - 会话管理器（仅需 get 方法）
 * @param agentRegistry - Agent 注册表
 * @returns 命令定义
 */
export function createStopCommand(
  sessionManager: Pick<SessionManager, 'get'>,
  agentRegistry: AgentRegistry,
): CommandDefinition {
  return {
    name: 'stop',
    description: '中止当前正在进行的 Agent 处理',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      const session = sessionManager.get(context.sessionKey);

      if (!session) {
        return '没有找到活跃会话。';
      }

      const cancelled = agentRegistry.cancel(context.sessionKey);
      if (!cancelled) {
        return '没有正在进行的处理。';
      }

      session.unlock();
      return 'Agent 处理已中止。';
    },
  };
}
