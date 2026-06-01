import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import { defineCommand } from '@aesyclaw/command/command-builder';
import type { CommandContext, Message } from '@aesyclaw/core/types';
import type { BuiltinCommandDependencies } from './types';

export function registerSessionBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  registry.register(
    defineCommand({
      name: 'model',
      description: '查看或切换当前会话的模型',
      usage: '/model [provider/model]',
      scope: 'system',
      allowDuringAgentProcessing: true,
      execute: async (args: string[], context: CommandContext): Promise<Message> => {
        const newModelId = args.join(' ').trim();

        if (newModelId.length === 0) {
          const agent = deps.agentRegistry.getAgent(context.sessionKey);
          if (agent !== undefined && agent !== null) {
            return { components: [{ type: 'Plain', text: `当前模型：${agent.modelIdentifier}` }] };
          }
          const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
          const currentModel = dbRecord?.model_id ?? '未知';
          return { components: [{ type: 'Plain', text: `当前模型：${currentModel}` }] };
        }

        try {
          deps.llmAdapter.resolveModel(newModelId);
        } catch (err) {
          return {
            components: [
              {
                type: 'Plain',
                text: `无效的模型标识符：${newModelId}\n${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }

        const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
        if (dbRecord !== null) {
          await deps.databaseManager.sessions.setModel(dbRecord.id, newModelId);
        }

        const agent = deps.agentRegistry.getAgent(context.sessionKey);
        if (agent !== undefined && agent !== null) {
          agent.setModel(newModelId);
        }

        return { components: [{ type: 'Plain', text: `已切换到模型：${newModelId}` }] };
      },
    }),
  );

  registry.register(
    defineCommand({
      name: 'clear',
      description: '清空当前会话的历史记录',
      scope: 'system',
      allowDuringAgentProcessing: false,
      execute: async (_args: string[], context: CommandContext): Promise<Message> => {
        const agent = deps.agentRegistry.getAgent(context.sessionKey);
        if (agent?.session.isLocked === true) {
          return { components: [{ type: 'Plain', text: 'Agent 正在处理中，无法清空会话。' }] };
        }

        const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
        if (dbRecord !== null) {
          await deps.sessionManager.clearById(dbRecord.id);
          deps.agentRegistry.unregisterAgent(context.sessionKey);
        }
        return { components: [{ type: 'Plain', text: '会话历史已清空。' }] };
      },
    }),
  );

  registry.register(
    defineCommand({
      name: 'compact',
      description: '压缩当前会话的历史记录',
      scope: 'system',
      allowDuringAgentProcessing: false,
      execute: async (_args: string[], context: CommandContext): Promise<Message> => {
        const session = await deps.sessionManager.create(context.sessionKey);
        const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
        const modelId = dbRecord?.model_id;
        if (modelId === undefined) {
          return { components: [{ type: 'Plain', text: '当前会话没有可用模型，无法压缩。' }] };
        }

        const summary = await session.compact(deps.llmAdapter, modelId);
        return { components: [{ type: 'Plain', text: `会话已压缩。\n\n摘要：\n${summary}` }] };
      },
    }),
  );
}
