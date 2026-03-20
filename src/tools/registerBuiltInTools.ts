import type { ToolContext, ToolRegistry } from './index.js';
import type { ToolSource } from './ToolRegistry.js';
import type { SkillManager } from '../skills/index.js';
import type { CronService } from '../cron/index.js';
import type { MCPClientManager } from '../mcp/index.js';
import type { PluginManager } from '../plugins/index.js';
import type { OutboundMessage, ToolDefinition } from '../types.js';
import type { AgentRoleService } from '../agent/core-roles/AgentRoleService.js';
import type { SessionMemoryService } from '../agent/core-memory/SessionMemoryService.js';
import type { SessionManager } from '../session/index.js';
import { registerCronTools } from '../cron/CronTools.js';
import { normalizeToolError } from './errors.js';
import { logger } from '../observability/index.js';

export interface ToolIntegrationOptions {
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  cronService: CronService;
  pluginManager: PluginManager;
  mcpManager: MCPClientManager | null;
  runSubAgentTasks: (
    tasks: Array<{ agentName: string; task: string }>,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ) => Promise<Array<{ agentName: string; task: string; success: boolean; result?: string; error?: string }>>;
  agentRoleService: AgentRoleService;
  sessionManager: SessionManager;
  memoryService?: SessionMemoryService;
}

export function registerBuiltInTools(options: ToolIntegrationOptions): void {
  const {
    toolRegistry,
    skillManager,
    cronService,
    pluginManager,
    runSubAgentTasks,
    agentRoleService,
    sessionManager,
    memoryService
  } = options;
  const log = logger.child('ToolIntegration');

  registerCronTools(toolRegistry, cronService);

  const publishOutboundMessage = async (message: OutboundMessage): Promise<void> => {
    await pluginManager.dispatchMessage(message);
  };

  const buildHistoryEntry = (content: string, media?: string[], files?: string[]): string => {
    const trimmed = content.trim();
    const attachmentParts: string[] = [];

    if (media && media.length > 0) {
      attachmentParts.push(`${media.length} 张图片`);
    }

    if (files && files.length > 0) {
      attachmentParts.push(`${files.length} 个文件`);
    }

    if (attachmentParts.length === 0) {
      return trimmed;
    }

    const attachmentSummary = `发送了${attachmentParts.join('、')}`;
    return trimmed ? `${trimmed}\n\n[附件: ${attachmentSummary}]` : `[附件: ${attachmentSummary}]`;
  };

  toolRegistry.register({
    name: 'read_skill',
    description: '读取 skill 文件；优先读 SKILL.md。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'skill 名称' },
        file: { type: 'string', description: '文件名；默认 SKILL.md' }
      },
      required: ['name']
    },
    execute: async (params: Record<string, any>) => {
      const skillName = String(params.name);
      const fileName = typeof params.file === 'string' ? params.file : undefined;
      const content = await skillManager.readSkillFile(skillName, fileName);
      return content || `Skill "${skillName}" or file not found`;
    }
  }, 'built-in' as ToolSource);

  toolRegistry.register({
    name: 'list_skill_files',
    description: '列出 skill 内文件。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'skill 名称' }
      },
      required: ['name']
    },
    execute: async (params: Record<string, any>) => {
      const skillName = String(params.name);
      const files = await skillManager.listSkillFiles(skillName);
      if (!files) return `Skill "${skillName}" not found`;
      if (files.length === 0) return `No files found in skill "${skillName}"`;
      return `Files in skill "${skillName}":\n${files.map((file) => `${file.name}${file.isDirectory ? '/' : ''}`).join('\n')}`;
    }
  }, 'built-in' as ToolSource);

  toolRegistry.register({
    name: 'send_msg_to_user',
    description: '向当前会话发送文本、图片或文件。LLM 在 Agent 执行过程中也可以使用该工具向用户同步当前步骤、说明正在进行的操作或汇报阶段性进展。',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '发送文本；可为空，但 content、media、files 至少要提供一个。'
        },
        media: {
          type: 'array',
          items: { type: 'string' },
          description: '图片路径数组。'
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '非图片文件路径数组。'
        }
      }
    },
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      const content = String(params.content ?? '');
      const media = Array.isArray(params.media)
        ? params.media.filter((item): item is string => typeof item === 'string')
        : undefined;
      const files = Array.isArray(params.files)
        ? params.files.filter((item): item is string => typeof item === 'string')
        : undefined;

      if (content.trim().length === 0 && (!media || media.length === 0) && (!files || files.length === 0)) {
        return '错误：content、media、files 至少需要提供一个。';
      }

      if (!context?.chatId || !context?.channel) {
        log.error('send_msg_to_user 缺少会话上下文', {
          hasChannel: !!context?.channel,
          hasChatId: !!context?.chatId
        });
        return '错误：无法获取当前会话信息，此工具只能在用户会话中使用。';
      }

      const outboundMessage: OutboundMessage = {
        channel: context.channel,
        chatId: context.chatId,
        content,
        messageType: context.messageType || 'private',
        media: media && media.length > 0 ? media : undefined,
        files: files && files.length > 0 ? files : undefined
      };

      try {
        await publishOutboundMessage(outboundMessage);
        if (context.sessionKey) {
          const historyEntry = buildHistoryEntry(content, media, files);
          if (historyEntry) {
            await sessionManager.addMessage(context.sessionKey, 'assistant', historyEntry);
          }
        }
        const attachmentCount = (media?.length || 0) + (files?.length || 0);
        const attachmentInfo = attachmentCount > 0 ? ` (包含 ${attachmentCount} 个附件)` : '';
        return `消息已发送${attachmentInfo}`;
      } catch (error) {
        log.error('send_msg_to_user 执行失败', {
          channel: context.channel,
          chatId: context.chatId,
          sessionKey: context.sessionKey,
          mediaCount: media?.length || 0,
          fileCount: files?.length || 0,
          error: normalizeToolError(error)
        });
        return `发送失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }, 'built-in' as ToolSource);

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
        log.error('call_agent 执行失败', {
          taskCount: rawTasks.length,
          error: normalizeToolError(error)
        });
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }, 'built-in' as ToolSource);

  if (memoryService?.hasLongTermMemory()) {
    toolRegistry.register({
      name: 'memory_list',
      description: '列出当前聊天对象的长期记忆，以及最近的记忆变更记录。涉及用户偏好、固定习惯、长期背景、既有约定或历史决策时，应优先先查这个工具。',
      parameters: {
        type: 'object',
        properties: {}
      },
      execute: async (_params: Record<string, any>, context?: ToolContext) => {
        if (!context?.channel || !context?.chatId) {
          return '错误：无法获取当前会话信息，此工具只能在用户会话中使用。';
        }

        try {
          const [entries, operations] = await Promise.all([
            memoryService.listLongTermMemory(context.channel, context.chatId),
            memoryService.listLongTermMemoryOperations(context.channel, context.chatId, 10)
          ]);

          return JSON.stringify({
            entries,
            recentOperations: operations
          }, null, 2);
        } catch (error) {
          log.error('memory_list 执行失败', {
            channel: context.channel,
            chatId: context.chatId,
            error: normalizeToolError(error)
          });
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }, 'built-in' as ToolSource);

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
        if (!context?.channel || !context?.chatId) {
          return '错误：无法获取当前会话信息，此工具只能在用户会话中使用。';
        }

        try {
          const results = await memoryService.applyLongTermMemoryOperations(
            context.channel,
            context.chatId,
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
          log.error('memory_manage 执行失败', {
            channel: context.channel,
            chatId: context.chatId,
            error: normalizeToolError(error)
          });
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }, 'built-in' as ToolSource);

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
        if (!context?.channel || !context?.chatId) {
          return '错误：无法获取当前会话信息，此工具只能在用户会话中使用。';
        }

        const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
          ? Math.max(1, Math.min(100, Math.floor(params.limit)))
          : 20;

        try {
          const operations = await memoryService.listLongTermMemoryOperations(context.channel, context.chatId, limit);
          return JSON.stringify({ items: operations }, null, 2);
        } catch (error) {
          log.error('memory_history 执行失败', {
            channel: context.channel,
            chatId: context.chatId,
            error: normalizeToolError(error)
          });
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }, 'built-in' as ToolSource);
  }

  const skills = skillManager.listSkills();
  if (skills.length > 0) {
    log.info('技能工具已注册', {
      skillCount: skills.length,
      skills: skills.map((skill) => skill.name)
    });
  }
}

export function registerMcpTools(toolRegistry: ToolRegistry, mcpManager: MCPClientManager): void {
  const log = logger.child('ToolIntegration');

  mcpManager.onToolsLoaded((tools: ToolDefinition[]) => {
    for (const tool of tools) {
      const toolName = tool.name;
      toolRegistry.register({
        name: toolName,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (params: Record<string, any>) => mcpManager.callTool(toolName, params),
        source: 'mcp' as ToolSource
      }, 'mcp');
    }
    log.info('MCP 工具已注册', { toolCount: tools.length });
  });
}
