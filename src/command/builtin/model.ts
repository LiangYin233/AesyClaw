/**
 * 内置 model 命令。
 *
 * 在对话过程中切换 Agent 使用的模型。
 *
 */

import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session-manager';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';

/**
 * 创建 model 命令定义。
 *
 * @param deps - 包含 sessionManager 和 agentEngine 的依赖项
 * @returns model 命令的 CommandDefinition
 */
export function createModelCommand(
  sessionManager: Pick<SessionManager, 'getOrCreateSession'>,
  agentEngine: Pick<AgentEngine, 'switchModel'>,
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

      const session = await sessionManager.getOrCreateSession(context.sessionKey);
      agentEngine.switchModel(session.agent, modelIdentifier);

      return `模型已切换为 ${modelIdentifier}`;
    },
  };
}
