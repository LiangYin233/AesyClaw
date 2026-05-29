import type { CommandDefinition, CommandContext, Message } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/session';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';

/**
 * 创建 /compact 命令，使用 LLM 压缩当前会话历史为摘要。
 * @param sessionManager - 会话管理器（仅需 get 方法）
 * @param llmAdapter - LLM 适配器
 * @param databaseManager - 数据库管理器（仅需 sessions）
 * @param agentRegistry - Agent 注册表
 * @param defaultModel - 默认模型 ID
 * @returns 命令定义
 */
export function createCompactCommand(
  sessionManager: Pick<SessionManager, 'get'>,
  llmAdapter: LlmAdapter,
  databaseManager: Pick<DatabaseManager, 'sessions'>,
): CommandDefinition {
  return {
    name: 'compact',
    description: '压缩当前会话历史以减少上下文长度',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<Message> => {
      const session = sessionManager.get(context.sessionKey);
      if (!session) {
        return { components: [{ type: 'Plain', text: '没有找到活跃会话。' }] };
      }

      const dbSession = await databaseManager.sessions.findByKey(context.sessionKey);
      const modelId = dbSession!.model_id!;
      const summary = await session.compact(llmAdapter, modelId);
      return { components: [{ type: 'Plain', text: `会话已压缩完成。\n${summary}` }] };
    },
  };
}
