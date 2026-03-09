import type { ToolContext, ToolRegistry } from '../tools/index.js';
import type { ToolSource } from '../tools/ToolRegistry.js';
import type { SkillManager } from '../skills/index.js';
import type { CronService } from '../cron/index.js';
import type { EventBus } from '../bus/EventBus.js';
import type { MCPClientManager } from '../mcp/index.js';
import type { PluginManager } from '../plugins/index.js';
import type { OutboundMessage } from '../types.js';
import { registerCronTools } from '../cron/CronTools.js';
import { logger } from '../logger/index.js';

export interface ToolIntegrationOptions {
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  cronService: CronService;
  eventBus: EventBus;
  pluginManager: PluginManager;
  mcpManager: MCPClientManager | null;
}

export function registerBuiltInTools(options: ToolIntegrationOptions): void {
  const {
    toolRegistry,
    skillManager,
    cronService,
    eventBus,
    pluginManager
  } = options;
  const log = logger.child({ prefix: 'ToolIntegration' });

  registerCronTools(toolRegistry, cronService, eventBus);

  const publishOutboundMessage = async (message: OutboundMessage): Promise<void> => {
    const processedMessage = await pluginManager.applyOnResponse(message) || message;
    await eventBus.publishOutbound(processedMessage);
  };

  toolRegistry.register({
    name: 'read_skill',
    description: '读取指定 skill 目录下的文件内容。用于读取 SKILL.md 或其他文件。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'skill 名称' },
        file: { type: 'string', description: '文件名（可选，默认读取 SKILL.md）' }
      },
      required: ['name']
    },
    execute: async (params: any) => {
      const content = await skillManager.readSkillFile(params.name, params.file);
      return content || `Skill "${params.name}" or file not found`;
    }
  }, 'built-in' as ToolSource);

  toolRegistry.register({
    name: 'list_skill_files',
    description: '列出指定 skill 目录下所有文件。用于查看 skill 包含哪些文件。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'skill 名称' }
      },
      required: ['name']
    },
    execute: async (params: any) => {
      const files = await skillManager.listSkillFiles(params.name);
      if (!files) return `Skill "${params.name}" not found`;
      if (files.length === 0) return `No files found in skill "${params.name}"`;
      return `Files in skill "${params.name}":\n${files.map(f => `${f.name}${f.isDirectory ? '/' : ''}`).join('\n')}`;
    }
  }, 'built-in' as ToolSource);

  toolRegistry.register({
    name: 'send_msg_to_user',
    description: `主动向用户发送消息和文件。**强烈推荐使用**，特别是生成图表、图片、文档等文件后立即发送给用户查看。

**典型用法**：使用 python_exec 生成图表后，立即调用此工具发送图表文件，而不是仅在最终回复中描述。用户更希望看到实际的图表。

参数：content（文本内容，支持 Markdown）、media（文件路径数组）`,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要发送的文本内容。可以是简短说明、详细分析报告等。支持 Markdown 格式。'
        },
        media: {
          type: 'array',
          items: { type: 'string' },
          description: '图片或文件的完整路径数组。例如：["/path/to/chart.png", "data.csv"]。通常是 python_exec 等工具生成的文件路径。'
        }
      },
      required: ['content']
    },
    execute: async (params: any, context?: ToolContext) => {
      const { content, media } = params;
      log.info(`[send_msg_to_user] Called with content length=${content?.length}, media count=${media?.length || 0}`);

      if (!context?.chatId || !context?.channel) {
        log.error(`[send_msg_to_user] No context available. Full context: ${JSON.stringify(context)}`);
        return '错误：无法获取当前会话信息。此工具只能在用户会话中使用。';
      }

      let outboundMsg: OutboundMessage = {
        channel: context.channel,
        chatId: context.chatId,
        content,
        messageType: context.messageType || 'private'
      };

      if (media && Array.isArray(media) && media.length > 0) {
        outboundMsg.media = media;
      }

      try {
        await publishOutboundMessage(outboundMsg);
        const mediaInfo = media && media.length > 0 ? ` (包含 ${media.length} 个文件)` : '';
        return `消息已发送${mediaInfo}`;
      } catch (error) {
        log.error('[send_msg_to_user] Failed:', error);
        return `发送失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }, 'built-in' as ToolSource);

  const skills = skillManager.listSkills();
  if (skills.length > 0) {
    log.info(`Registered skill tools. Available skills: ${skills.map(s => s.name).join(', ')}`);
  }
}

export function registerMcpTools(toolRegistry: ToolRegistry, mcpManager: MCPClientManager): void {
  const log = logger.child({ prefix: 'ToolIntegration' });

  mcpManager.onToolsLoaded((tools) => {
    log.debug(`MCP tools loaded callback triggered, tools count: ${tools.length}`);
    for (const tool of tools) {
      const toolName = tool.name;
      log.debug(`Registering MCP tool: ${toolName}`);
      toolRegistry.register({
        name: toolName,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (params: any) => mcpManager.callTool(toolName, params),
        source: 'mcp' as ToolSource
      }, 'mcp');
    }
    log.info(`MCP tools registered: ${tools.length}`);
  });
}
