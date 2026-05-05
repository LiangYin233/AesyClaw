import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session/manager';
import { Agent } from '@aesyclaw/agent/agent';

export function createStopCommand(sessionManager: Pick<SessionManager, 'get'>): CommandDefinition {
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

      const cancelled = Agent.cancel(context.sessionKey);
      session.unlock();

      if (!cancelled) {
        session.unlock();
      }

      return 'Agent 处理已中止。';
    },
  };
}
