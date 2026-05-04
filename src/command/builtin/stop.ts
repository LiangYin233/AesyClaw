/**
 * 内置 stop 命令。
 *
 * 中止当前正在进行的 Agent 处理。
 *
 */

import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session-manager';

/**
 * 创建 stop 命令定义。
 *
 * @param deps - 包含 sessionManager 的依赖项
 * @returns stop 命令的 CommandDefinition
 */
export function createStopCommand(
  sessionManager: Pick<SessionManager, 'getSession' | 'endAgentProcessing'>,
): CommandDefinition {
  return {
    name: 'stop',
    description: '中止当前正在进行的 Agent 处理',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      const session = sessionManager.getSession(context.sessionKey);

      if (!session) {
        return '没有找到活跃会话。';
      }

      session.agent.abort();
      session.agent.clearAllQueues();
      sessionManager.endAgentProcessing(context.sessionKey);

      return 'Agent 处理已中止。';
    },
  };
}
