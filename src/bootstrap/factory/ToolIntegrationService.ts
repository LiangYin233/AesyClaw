import type { ToolContext, ToolRegistry } from '../../tools/index.js';
import type { ToolSource } from '../../tools/ToolRegistry.js';
import type { SkillManager } from '../../skills/index.js';
import type { CronService } from '../../cron/index.js';
import type { MCPClientManager } from '../../mcp/index.js';
import type { PluginManager } from '../../plugins/index.js';
import type { OutboundMessage, ToolDefinition } from '../../types.js';
import type { AgentRuntime } from '../../agent/runtime/AgentRuntime.js';
import type { AgentRoleService } from '../../agent/roles/AgentRoleService.js';
import { registerCronTools } from '../../cron/CronTools.js';
import { normalizeError } from '../../errors/index.js';
import { logger } from '../../observability/index.js';

export interface ToolIntegrationOptions {
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  cronService: CronService;
  pluginManager: PluginManager;
  mcpManager: MCPClientManager | null;
  agentRuntime: AgentRuntime;
  agentRoleService: AgentRoleService;
}

export function registerBuiltInTools(options: ToolIntegrationOptions): void {
  const {
    toolRegistry,
    skillManager,
    cronService,
    pluginManager,
    agentRuntime,
    agentRoleService
  } = options;
  const log = logger.child('ToolIntegration');

  registerCronTools(toolRegistry, cronService);

  const publishOutboundMessage = async (message: OutboundMessage): Promise<void> => {
    await pluginManager.dispatchMessage(message);
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
        const attachmentCount = (media?.length || 0) + (files?.length || 0);
        const attachmentInfo = attachmentCount > 0 ? ` (包含 ${attachmentCount} 个附件)` : '';
        return `消息已发送${attachmentInfo}`;
      } catch (error) {
        log.error('send_msg_to_user 执行失败', {
          channel: context.channel,
          chatId: context.chatId,
          mediaCount: media?.length || 0,
          fileCount: files?.length || 0,
          error: normalizeError(error)
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
        const results = await agentRuntime.runSubAgentTasks(rawTasks, {
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
          error: normalizeError(error)
        });
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }, 'built-in' as ToolSource);

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
