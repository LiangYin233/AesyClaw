import type { AgentRoleService } from '../../../agent/infrastructure/roles/AgentRoleService.js';
import type { ToolContext, ToolRegistry } from '../ToolRegistry.js';
import { normalizeToolError } from '../errors.js';
import {
  type BuiltInLogger,
  formatToolError,
  rethrowToolAbortError,
  throwIfToolAborted
} from './shared.js';

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
  runTemporarySubAgentTask: (
    baseAgentName: string | undefined,
    task: string,
    systemPrompt: string,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ) => Promise<string>;
  agentRoleService: AgentRoleService;
  log: BuiltInLogger;
}): void {
  const { toolRegistry, runSubAgentTasks, runTemporarySubAgentTask, agentRoleService, log } = args;

  toolRegistry.register({
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
    },
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      throwIfToolAborted(context?.signal);
      if (!Array.isArray(params.items) || params.items.length === 0) {
        return 'Error: call_agent requires { items: [{ agentName, task }, ...] }';
      }

      const rawTasks = params.items.map((item: any) => ({
        agentName: String(item?.agentName || ''),
        task: String(item?.task || '')
      }));

      log.info('call_agent 开始执行', {
        taskCount: rawTasks.length,
        agents: rawTasks.map((item) => item.agentName)
      });

      const invalidTask = rawTasks.find((item) => !item.agentName || !item.task);
      if (invalidTask) {
        return 'Error: each items entry requires agentName and task';
      }

      const missingRole = rawTasks.find((item) => !agentRoleService.getResolvedRole(item.agentName));
      if (missingRole) {
        return `Error: Agent role not found: ${missingRole.agentName}`;
      }

      try {
        const results = await runSubAgentTasks(rawTasks, {
          channel: context?.channel,
          chatId: context?.chatId,
          messageType: context?.messageType,
          signal: context?.signal
        });

        log.info('call_agent 执行完成', {
          taskCount: results.length,
          successCount: results.filter((item) => item.success).length,
          failedCount: results.filter((item) => !item.success).length
        });

        return JSON.stringify({
          total: results.length,
          success: results.filter((item) => item.success).length,
          failed: results.filter((item) => !item.success).length,
          results
        }, null, 2);
      } catch (error) {
        rethrowToolAbortError(error, context?.signal);
        log.error('call_agent 执行失败', {
          taskCount: rawTasks.length,
          error: normalizeToolError(error)
        });
        return `Error: ${formatToolError(error)}`;
      }
    }
  }, 'built-in');

  toolRegistry.register({
    name: 'call_temp_agent',
    description: '当用户任务需要同时进行，或可以拆分出一个可独立编排的子任务时，基于当前 Agent 配置创建一次性临时 Agent 分身，并利用其并行执行该任务。该分身仅临时覆写 systemPrompt，不会写入配置。参数必须是 { task: string, systemPrompt: string }。',
    parameters: {
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
    },
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      throwIfToolAborted(context?.signal);
      const task = String(params.task || '');
      const systemPrompt = String(params.systemPrompt || '');
      if (!task || !systemPrompt) {
        return 'Error: call_temp_agent requires { task: string, systemPrompt: string }';
      }

      try {
        return await runTemporarySubAgentTask(context?.agentName, task, systemPrompt, {
          channel: context?.channel,
          chatId: context?.chatId,
          messageType: context?.messageType,
          signal: context?.signal
        });
      } catch (error) {
        rethrowToolAbortError(error, context?.signal);
        log.error('call_temp_agent 执行失败', {
          baseAgentName: context?.agentName,
          channel: context?.channel,
          chatId: context?.chatId,
          error: normalizeToolError(error)
        });
        return `Error: ${formatToolError(error)}`;
      }
    }
  }, 'built-in');
}
