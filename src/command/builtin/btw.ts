import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import type { SessionManager } from '@aesyclaw/agent/session-manager';
import type { CommandContext, CommandDefinition } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';

/**
 * 创建 btw（by the way）命令定义。
 *
 * 在当前会话上下文中执行一次独立提问，不干扰主对话流。
 *
 * @param deps - 包含 sessionManager 和 agentEngine 的依赖项
 * @returns btw 命令的 CommandDefinition
 */
export function createBtwCommand(
  sessionManager: Pick<SessionManager, 'getOrCreateSession'>,
  agentEngine: Pick<AgentEngine, 'processEphemeral'>,
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

      const session = await sessionManager.getOrCreateSession(context.sessionKey);
      const outbound = await agentEngine.processEphemeral(
        context.sessionKey,
        session.memory,
        session.activeRole,
        content,
      );

      return getMessageText(outbound);
    },
  };
}
