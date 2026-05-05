import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session/manager';

export function createModelCommand(
  sessionManager: Pick<SessionManager, 'create'>,
): CommandDefinition {
  return {
    name: 'model',
    description: '切换模型 (用法: /model <provider/modelId>)',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (args: string[], context: CommandContext): Promise<string> => {
      const modelIdentifier = args[0];

      if (!modelIdentifier) {
        return '用法: /model <provider/modelId> (例如 /model openai/gpt-4o)';
      }

      const session = await sessionManager.create(context.sessionKey);
      session.modelOverride = modelIdentifier;

      return `模型已切换为 ${modelIdentifier}`;
    },
  };
}
