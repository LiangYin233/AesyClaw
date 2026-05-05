import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session/manager';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';

export function createStopCommand(
  sessionManager: Pick<SessionManager, 'get'>,
  agentEngine?: Pick<AgentEngine, 'cancelRun'>,
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

      const cancelledWorker = agentEngine?.cancelRun(context.sessionKey) ?? false;
      session.unlock();

      if (!cancelledWorker) {
        session.unlock();
      }

      return 'Agent 处理已中止。';
    },
  };
}
