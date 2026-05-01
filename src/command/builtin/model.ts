/**
 * 内置 model 命令。
 *
 * 在对话过程中切换 Agent 使用的模型。
 *
 */

import type { CommandDefinition, CommandContext } from '../../core/types';
import type { SessionManager } from '../../agent/session-manager';
import type { AgentEngine } from '../../agent/agent-engine';

export type ModelCommandDeps = {
  sessionManager: Pick<SessionManager, 'getOrCreateSession'>;
  agentEngine: Pick<AgentEngine, 'switchModel'>;
}

/**
 * 创建 model 命令定义。
 *
 * @param deps - 包含 sessionManager 和 agentEngine 的依赖项
 * @returns model 命令的 CommandDefinition
 */
export function createModelCommand(deps: ModelCommandDeps): CommandDefinition {
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

      const session = await deps.sessionManager.getOrCreateSession(context.sessionKey);
      deps.agentEngine.switchModel(session.agent, modelIdentifier);

      return `模型已切换为 ${modelIdentifier}`;
    },
  };
}
