import type { CommandDefinition, CommandContext, Message } from '@aesyclaw/core/types';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';

/**
 * 创建 /model 命令，用于切换当前 Agent 使用的模型。
 * @param llmAdapter - LLM 适配器
 * @param agentRegistry - Agent 注册表
 * @param databaseManager - 数据库管理器（持久化模型绑定）
 * @returns 命令定义
 */
export function createModelCommand(
  llmAdapter: LlmAdapter,
  agentRegistry: AgentRegistry,
  databaseManager?: Pick<DatabaseManager, 'sessions'>,
): CommandDefinition {
  return {
    name: 'model',
    description: '切换模型 (用法: /model <provider/modelId>)',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (args: string[], context: CommandContext): Promise<Message> => {
      const modelIdentifier = args[0];

      if (!modelIdentifier) {
        return {
          components: [
            { type: 'Plain', text: '用法: /model <provider/modelId> (例如 /model openai/gpt-4o)' },
          ],
        };
      }

      try {
        llmAdapter.resolveModel(modelIdentifier);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { components: [{ type: 'Plain', text: `模型切换失败: ${message}` }] };
      }

      const agent = agentRegistry.getAgent(context.sessionKey);
      if (!agent) {
        return {
          components: [
            { type: 'Plain', text: '当前没有活跃的 Agent，无法切换模型。请先发送一条消息。' },
          ],
        };
      }

      agent.setModel(modelIdentifier);

      // 持久化模型绑定
      if (databaseManager) {
        const rec = await databaseManager.sessions.findByKey(context.sessionKey);
        if (rec) {
          await databaseManager.sessions.setModel(rec.id, modelIdentifier);
        }
      }

      return { components: [{ type: 'Plain', text: `模型已切换为 ${modelIdentifier}` }] };
    },
  };
}
