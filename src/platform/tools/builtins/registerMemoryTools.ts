import type { SessionMemoryService } from '../../../agent/infrastructure/memory/SessionMemoryService.js';
import type { ToolContext, ToolRegistry } from '../ToolRegistry.js';
import {
  type BuiltInLogger,
  formatToolError,
  requireSessionContext,
  rethrowToolAbortError,
  throwIfToolAborted
} from './shared.js';

export function registerMemoryTools(args: {
  toolRegistry: ToolRegistry;
  memoryService?: SessionMemoryService;
  log: BuiltInLogger;
}): void {
  const { toolRegistry, memoryService } = args;

  if (!memoryService?.hasLongTermMemory()) {
    return;
  }

  toolRegistry.register({
    name: 'memory_list',
    description: '列出当前聊天对象的长期记忆，以及最近的记忆变更记录。涉及用户偏好、固定习惯、长期背景、既有约定或历史决策时，应优先先查这个工具。',
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async (_params: Record<string, any>, context?: ToolContext) => {
      throwIfToolAborted(context?.signal);

      try {
        const { channel, chatId } = requireSessionContext(context);
        const [entries, operations] = await Promise.all([
          memoryService.listLongTermMemory(channel, chatId),
          memoryService.listLongTermMemoryOperations(channel, chatId, 10)
        ]);

        return JSON.stringify({
          entries,
          recentOperations: operations
        }, null, 2);
      } catch (error) {
        rethrowToolAbortError(error, context?.signal);
        return `Error: ${formatToolError(error)}`;
      }
    }
  }, 'built-in');

  toolRegistry.register({
    name: 'memory_manage',
    description: '对当前聊天对象的长期记忆执行 create、update、merge、archive、delete 操作。确认新的稳定偏好、长期约束、项目背景或长期规则后，应主动用它维护记忆。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'merge', 'archive', 'delete']
        },
        entryId: {
          type: 'number',
          description: 'update/archive/delete/merge 的目标记忆 ID'
        },
        sourceIds: {
          type: 'array',
          items: { type: 'number' },
          description: 'merge 时需要合并进目标记忆的源记忆 ID 列表'
        },
        kind: {
          type: 'string',
          enum: ['profile', 'preference', 'project', 'rule', 'context', 'other']
        },
        content: {
          type: 'string',
          description: 'create 或 update/merge 后的记忆内容'
        },
        reason: {
          type: 'string',
          description: '操作原因'
        },
        evidence: {
          type: 'array',
          items: { type: 'string' },
          description: '支撑这次操作的关键证据片段'
        }
      },
      required: ['action']
    },
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      throwIfToolAborted(context?.signal);

      try {
        const { channel, chatId } = requireSessionContext(context);
        const results = await memoryService.applyLongTermMemoryOperations(
          channel,
          chatId,
          [{
            action: String(params.action || '') as 'create' | 'update' | 'merge' | 'archive' | 'delete',
            entryId: typeof params.entryId === 'number' ? params.entryId : undefined,
            sourceIds: Array.isArray(params.sourceIds)
              ? params.sourceIds.filter((value: unknown): value is number => typeof value === 'number')
              : undefined,
            kind: typeof params.kind === 'string' ? params.kind as 'profile' | 'preference' | 'project' | 'rule' | 'context' | 'other' : undefined,
            content: typeof params.content === 'string' ? params.content : undefined,
            reason: typeof params.reason === 'string' ? params.reason : undefined,
            evidence: Array.isArray(params.evidence)
              ? params.evidence.filter((value: unknown): value is string => typeof value === 'string')
              : undefined
          }],
          'tool'
        );

        return JSON.stringify({
          success: true,
          results
        }, null, 2);
      } catch (error) {
        rethrowToolAbortError(error, context?.signal);
        return `Error: ${formatToolError(error)}`;
      }
    }
  }, 'built-in');

  toolRegistry.register({
    name: 'memory_history',
    description: '查看当前聊天对象的长期记忆操作历史。需要追溯某条长期记忆为何被创建、更新、合并、归档或删除时使用。',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '返回最近多少条操作记录，默认 20'
        }
      }
    },
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      throwIfToolAborted(context?.signal);

      const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(100, Math.floor(params.limit)))
        : 20;

      try {
        const { channel, chatId } = requireSessionContext(context);
        const operations = await memoryService.listLongTermMemoryOperations(channel, chatId, limit);
        return JSON.stringify({ items: operations }, null, 2);
      } catch (error) {
        rethrowToolAbortError(error, context?.signal);
        return `Error: ${formatToolError(error)}`;
      }
    }
  }, 'built-in');
}
