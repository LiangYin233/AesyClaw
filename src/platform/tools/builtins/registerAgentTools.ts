import type { AgentRoleService } from '../../../agent/infrastructure/roles/AgentRoleService.js';
import type { ToolContext, ToolRegistry } from '../ToolRegistry.js';
import type { ToolDefinition } from '../../../types.js';
import {
  type BuiltInLogger,
  formatToolError,
  rethrowToolAbortError,
  throwIfToolAborted
} from './shared.js';

export function getAgentToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'call_agent',
      description: '当用户任务需要同时进行，或可以拆分为多个可独立编排的子任务时，调用多个 Agent 角色并发执行。参数必须是 { items: [{ agentName, task }, ...] }，等待全部完成后统一返回结果。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: '并发子 Agent 任务列表。',
            items: {
              type: 'object',
              properties: {
                agentName: { type: 'string', description: '目标 Agent 角色名称' },
                task: { type: 'string', description: '交给子 Agent 的任务描述' }
              },
              required: ['agentName', 'task']
            }
          }
        },
        required: ['items']
      }
    },
    {
      name: 'call_temp_agent',
      description: '当用户任务需要同时进行，或可以拆分为多个可独立编排的临时子任务时，基于当前 Agent 配置创建一次性临时 Agent 分身并发执行。该分身仅临时覆写 systemPrompt，不会写入配置。参数必须是 { items: [{ task, systemPrompt }, ...] }。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: '并发临时 Agent 任务列表。',
            items: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: '交给临时 Agent 的任务描述。'
                },
                systemPrompt: {
                  type: 'string',
                  description: '本次临时 Agent 使用的 system prompt。'
                }
              },
              required: ['task', 'systemPrompt']
            }
          }
        },
        required: ['items']
      }
    }
  ];
}

export function registerAgentTools(args: {
  toolRegistry: ToolRegistry;
  runSubAgentTasks: (
    tasks: Array<{ agentName: string; task: string }>,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ) => Promise<Array<{ agentName: string; task: string; success: boolean; result?: string; error?: string }>>;
  runTemporarySubAgentTasks: (
    baseAgentName: string | undefined,
    tasks: Array<{ task: string; systemPrompt: string }>,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ) => Promise<Array<{ task: string; success: boolean; result?: string; error?: string }>>;
  agentRoleService: AgentRoleService;
  log: BuiltInLogger;
}): void {
  const { toolRegistry, runSubAgentTasks, runTemporarySubAgentTasks, agentRoleService, log } = args;
  const [callAgentDefinition, callTempAgentDefinition] = getAgentToolDefinitions();

  toolRegistry.register({
    ...callAgentDefinition,
    timeout: false,
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      throwIfToolAborted(context?.signal);
      if (!Array.isArray(params.items) || params.items.length === 0) {
        return 'Error: call_agent requires { items: [{ agentName, task }, ...] }';
      }

      const rawTasks = params.items.map((item: any) => ({
        agentName: String(item?.agentName || ''),
        task: String(item?.task || '')
      }));

      const invalidTask = rawTasks.find((item) => !item.agentName || !item.task);
      if (invalidTask) {
        return 'Error: each items entry requires agentName and task';
      }

      const missingRole = rawTasks.find((item) => !agentRoleService.getResolvedRole(item.agentName));
      if (missingRole) {
        return `Error: Agent role not found: ${missingRole.agentName}`;
      }

      try {
        log.info(`准备并发派发 ${rawTasks.length} 个子 Agent`, {
          sessionKey: context?.sessionKey,
          channel: context?.channel,
          chatId: context?.chatId,
          agentName: context?.agentName,
          toolName: 'call_agent',
          taskCount: rawTasks.length
        });
        const results = await runSubAgentTasks(rawTasks, {
          channel: context?.channel,
          chatId: context?.chatId,
          messageType: context?.messageType,
          signal: context?.signal
        });
        const success = results.filter((item) => item.success).length;
        const failed = results.length - success;
        log.info('子 Agent 并发执行完成', {
          sessionKey: context?.sessionKey,
          channel: context?.channel,
          chatId: context?.chatId,
          agentName: context?.agentName,
          toolName: 'call_agent',
          taskCount: results.length,
          success,
          failed
        });

        return JSON.stringify({
          total: results.length,
          success,
          failed,
          results
        }, null, 2);
      } catch (error) {
        rethrowToolAbortError(error, context?.signal);
        log.warn('子 Agent 并发执行失败', {
          sessionKey: context?.sessionKey,
          channel: context?.channel,
          chatId: context?.chatId,
          agentName: context?.agentName,
          toolName: 'call_agent',
          error
        });
        return `Error: ${formatToolError(error)}`;
      }
    }
  }, 'built-in');

  const buildBatchResult = <T extends { success: boolean }>(results: T[]) => {
    const success = results.filter((item) => item.success).length;
    const failed = results.length - success;

    return {
      total: results.length,
      success,
      failed,
      results
    };
  };

  toolRegistry.register({
    ...callTempAgentDefinition,
    timeout: false,
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      throwIfToolAborted(context?.signal);
      if (!Array.isArray(params.items) || params.items.length === 0) {
        return 'Error: call_temp_agent requires { items: [{ task, systemPrompt }, ...] }';
      }

      const rawTasks = params.items.map((item: any) => ({
        task: String(item?.task || ''),
        systemPrompt: String(item?.systemPrompt || '')
      }));
      const invalidTask = rawTasks.find((item) => !item.task || !item.systemPrompt);
      if (invalidTask) {
        return 'Error: each items entry requires task and systemPrompt';
      }

      try {
        log.info(`准备并发派发 ${rawTasks.length} 个临时 Agent`, {
          sessionKey: context?.sessionKey,
          channel: context?.channel,
          chatId: context?.chatId,
          agentName: context?.agentName,
          toolName: 'call_temp_agent',
          taskCount: rawTasks.length
        });
        const results = await runTemporarySubAgentTasks(context?.agentName, rawTasks, {
          channel: context?.channel,
          chatId: context?.chatId,
          messageType: context?.messageType,
          signal: context?.signal
        });
        const aggregate = buildBatchResult(results);
        log.info('临时 Agent 并发执行完成', {
          sessionKey: context?.sessionKey,
          channel: context?.channel,
          chatId: context?.chatId,
          agentName: context?.agentName,
          toolName: 'call_temp_agent',
          taskCount: aggregate.total,
          success: aggregate.success,
          failed: aggregate.failed
        });
        return JSON.stringify(aggregate, null, 2);
      } catch (error) {
        rethrowToolAbortError(error, context?.signal);
        log.warn('临时 Agent 并发执行失败', {
          sessionKey: context?.sessionKey,
          channel: context?.channel,
          chatId: context?.chatId,
          agentName: context?.agentName,
          toolName: 'call_temp_agent',
          error
        });
        return `Error: ${formatToolError(error)}`;
      }
    }
  }, 'built-in');
}
