import type { ToolContext, ToolRegistry } from '../../tools/index.js';
import type { ToolSource } from '../../tools/ToolRegistry.js';
import type { SkillManager } from '../../skills/index.js';
import type { CronService } from '../../cron/index.js';
import type { EventBus } from '../../bus/EventBus.js';
import type { MCPClientManager } from '../../mcp/index.js';
import type { PluginManager } from '../../plugins/index.js';
import type { OutboundMessage, ToolDefinition } from '../../types.js';
import { registerCronTools } from '../../cron/CronTools.js';
import { logger } from '../../logger/index.js';

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
    description: '向当前会话发送文本或附件。',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '发送文本。'
        },
        media: {
          type: 'array',
          items: { type: 'string' },
          description: '附件路径数组。'
        }
      },
      required: ['content']
    },
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      const content = String(params.content ?? '');
      const media = Array.isArray(params.media)
        ? params.media.filter((item): item is string => typeof item === 'string')
        : undefined;

      log.info(`[send_msg_to_user] Called with content length=${content.length}, media count=${media?.length || 0}`);

      if (!context?.chatId || !context?.channel) {
        log.error(`[send_msg_to_user] No context available. Full context: ${JSON.stringify(context)}`);
        return '错误：无法获取当前会话信息，此工具只能在用户会话中使用。';
      }

      const outboundMessage: OutboundMessage = {
        channel: context.channel,
        chatId: context.chatId,
        content,
        messageType: context.messageType || 'private',
        media: media && media.length > 0 ? media : undefined
      };

      try {
        await publishOutboundMessage(outboundMessage);
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
    log.info(`Registered skill tools. Available skills: ${skills.map((skill) => skill.name).join(', ')}`);
  }
}

export function registerMcpTools(toolRegistry: ToolRegistry, mcpManager: MCPClientManager): void {
  const log = logger.child({ prefix: 'ToolIntegration' });

  mcpManager.onToolsLoaded((tools: ToolDefinition[]) => {
    log.debug(`MCP tools loaded callback triggered, tools count: ${tools.length}`);
    for (const tool of tools) {
      const toolName = tool.name;
      log.debug(`Registering MCP tool: ${toolName}`);
      toolRegistry.register({
        name: toolName,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (params: Record<string, any>) => mcpManager.callTool(toolName, params),
        source: 'mcp' as ToolSource
      }, 'mcp');
    }
    log.info(`MCP tools registered: ${tools.length}`);
  });
}
