import { serializeSessionKey, type CommandDefinition, type CommandContext } from '@aesyclaw/core/types';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import { Agent } from '@aesyclaw/agent/agent';

export function createModelCommand(llmAdapter: LlmAdapter): CommandDefinition {
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

      try {
        llmAdapter.resolveModel(modelIdentifier);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `模型切换失败: ${message}`;
      }

      const agent = Agent.activeAgents.get(serializeSessionKey(context.sessionKey));
      if (!agent) {
        return '当前没有活跃的 Agent，无法切换模型。请先发送一条消息。';
      }

      agent.setModel(modelIdentifier);
      return `模型已切换为 ${modelIdentifier}`;
    },
  };
}
