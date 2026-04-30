import type { AgentEngine } from '../../agent/agent-engine';
import type { SessionManager } from '../../agent/session-manager';
import type { CommandContext, CommandDefinition } from '../../core/types';

export interface BtwCommandDeps {
  sessionManager: Pick<SessionManager, 'getOrCreateSession'>;
  agentEngine: Pick<AgentEngine, 'processEphemeral'>;
}

export function createBtwCommand(deps: BtwCommandDeps): CommandDefinition {
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

      const session = await deps.sessionManager.getOrCreateSession(context.sessionKey);
      const outbound = await deps.agentEngine.processEphemeral({
        sessionKey: context.sessionKey,
        sessionId: session.sessionId,
        memory: session.memory,
        role: session.activeRole,
        content,
      });

      return outbound.content;
    },
  };
}
