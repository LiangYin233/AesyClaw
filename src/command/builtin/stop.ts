import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/session';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';

export function createStopCommand(sessionManager: Pick<SessionManager, 'get'>, agentRegistry: AgentRegistry): CommandDefinition {
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