import { join } from 'path';
import { EventBus } from '../bus/EventBus.js';
import { AgentLoop } from '../agent/AgentLoop.js';
import { ChannelManager } from '../channels/index.js';
import { createProvider } from '../providers/index.js';
import { ToolRegistry } from '../tools/index.js';
import type { ToolSource } from '../tools/ToolRegistry.js';
import { SessionManager } from '../session/index.js';
import { MCPClientManager } from '../mcp/index.js';
import { PluginManager } from '../plugins/index.js';
import { SkillManager } from '../skills/index.js';
import { APIServer } from '../api/index.js';
import { CronService } from '../cron/index.js';
import { registerCronTools } from '../cron/CronTools.js';
import { logger } from '../logger/index.js';
import type { Config } from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import type { AgentLoop as AgentLoopType } from '../agent/AgentLoop.js';
import type { CronJob } from '../cron/index.js';
import type { PluginManager as PluginManagerType } from '../plugins/index.js';
import type { SessionManager as SessionManagerType } from '../session/index.js';
import type { ChannelManager as ChannelManagerType } from '../channels/index.js';
import type { ToolRegistry as ToolRegistryType } from '../tools/index.js';
import type { APIServer as APIServerType } from '../api/server.js';

export interface Services {
  eventBus: EventBus;
  provider: LLMProvider;
  toolRegistry: ToolRegistryType;
  sessionManager: SessionManagerType;
  channelManager: ChannelManagerType;
  pluginManager: PluginManagerType;
  agent: AgentLoopType;
  cronService: CronService;
  mcpManager: MCPClientManager | null;
  skillManager: SkillManager | null;
  config: Config;
  workspace: string;
  apiServer: APIServerType;
}

export interface ServiceFactoryOptions {
  workspace: string;
  config: Config;
  port: number;
  onCronJob?: (job: CronJob) => Promise<void>;
}

export function parseTarget(to: string): { chatId: string; messageType: 'private' | 'group' } | null {
  const match = to.match(/^(private|group):(.+)$/);
  if (!match) return null;
  return {
    chatId: match[2],
    messageType: match[1] as 'private' | 'group'
  };
}

export class ServiceFactory {
  private log = logger.child({ prefix: 'ServiceFactory' });

  async create(options: ServiceFactoryOptions): Promise<Services> {
    const { workspace, config, port, onCronJob } = options;

    logger.setLevel(config.log?.level || 'info');
    const log = logger.child({ prefix: 'AesyClaw' });

    log.info('Initializing services...');

    const eventBus = new EventBus();
    log.debug('EventBus created');

    const providerConfig = config.providers[config.agent.defaults.provider];
    const provider = createProvider(config.agent.defaults.provider, providerConfig);
    log.debug('Provider created');

    const toolRegistry = new ToolRegistry();
    log.debug('ToolRegistry created');

    const sessionManager = new SessionManager(
      join(workspace, '.aesyclaw', 'sessions'),
      config.agent.defaults.maxSessions || 100
    );
    await sessionManager.ready();
    await sessionManager.loadAll();
    log.info(`SessionManager ready, ${sessionManager.count()} sessions loaded`);

    const pluginManager = new PluginManager(
      {
        config,
        eventBus,
        agent: null as AgentLoopType | null,
        workspace,
        registerTool: (tool) => toolRegistry.register(tool as any),
        getToolRegistry: () => toolRegistry as any,
        logger,
        sendMessage: async (channel, chatId, content, messageType) => {
          await eventBus.publishOutbound({ channel, chatId, content, messageType: messageType || 'private' });
        }
      },
      toolRegistry as any
    );

    if (config.plugins) {
      pluginManager.setPluginConfigs(config.plugins as Record<string, { enabled: boolean; options?: Record<string, any> }>);
    }

    const newPluginConfigs = await pluginManager.applyDefaultConfigs();
    if (Object.keys(newPluginConfigs).length > 0) {
      config.plugins = newPluginConfigs;
      const { ConfigLoader } = await import('../config/loader.js');
      await ConfigLoader.save(config);
      log.info('Applied default plugin configs');
    }

    if (config.plugins && Object.keys(config.plugins).length > 0) {
      await pluginManager.loadFromConfig(config.plugins);
    }

    const cronService = new CronService(
      join(workspace, '.aesyclaw', 'cron-jobs.json'),
      onCronJob || (async () => {})
    );
    await cronService.start();
    log.debug('CronService started');

    const channelManager = new ChannelManager(eventBus);
    log.debug('ChannelManager created');

    for (const [channelName, channelConfig] of Object.entries(config.channels)) {
      if (channelConfig?.enabled) {
        const channel = channelManager.createChannel(channelName, channelConfig);
        if (channel) {
          log.info(`Channel enabled: ${channelName}`);
        } else {
          log.warn(`Channel plugin not found: ${channelName}`);
        }
      }
    }

    // Initialize SkillManager
    let skillManager: SkillManager | null = null;
    const skillsConfig = config.skills;
    if (skillsConfig?.enabled) {
      skillManager = new SkillManager(skillsConfig.directory || './skills');
      if (skillsConfig.autoLoad !== false) {
        await skillManager.loadFromDirectory();
      }
      log.info(`SkillManager initialized with ${skillManager.listSkills().length} skills`);

      // 注册 read_skill 工具 - 读取 skill 文件
      toolRegistry.register({
        name: 'read_skill',
        description: '读取指定 skill 目录下的文件内容。用于读取 SKILL.md 或其他文件。',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'skill 名称'
            },
            file: {
              type: 'string',
              description: '文件名（可选，默认读取 SKILL.md）'
            }
          },
          required: ['name']
        },
        execute: async (params: any) => {
          const skillName = params.name;
          const fileName = params.file;
          const content = await skillManager!.readSkillFile(skillName, fileName);
          return content || `Skill "${skillName}" or file not found`;
        }
      }, 'built-in' as ToolSource);

      // 注册 list_skill_files 工具 - 列出 skill 目录下的文件
      toolRegistry.register({
        name: 'list_skill_files',
        description: '列出指定 skill 目录下所有文件。用于查看 skill 包含哪些文件。',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'skill 名称'
            }
          },
          required: ['name']
        },
        execute: async (params: any) => {
          const skillName = params.name;
          const files = await skillManager!.listSkillFiles(skillName);
          if (!files) {
            return `Skill "${skillName}" not found`;
          }
          if (files.length === 0) {
            return `No files found in skill "${skillName}"`;
          }
          const fileList = files.map(f => `${f.name}${f.isDirectory ? '/' : ''}`).join('\n');
          return `Files in skill "${skillName}":\n${fileList}`;
        }
      }, 'built-in' as ToolSource);

      // 列出所有可用 skills
      const skills = skillManager.listSkills();
      if (skills.length > 0) {
        const skillNames = skills.map(s => s.name).join(', ');
        log.info(`Registered read_skill, list_skill_files tools. Available skills: ${skillNames}`);
      }
    }

    const agent = new AgentLoop(
      eventBus,
      provider,
      toolRegistry,
      sessionManager,
      workspace,
      config.agent.defaults.systemPrompt,
      config.agent.defaults.maxToolIterations,
      config.agent.defaults.model,
      config.agent.defaults.contextMode,
      config.agent.defaults.memoryWindow,
      skillManager || undefined
    );

    pluginManager.context.agent = agent;
    pluginManager.updateAgent(agent);
    agent.setPluginManager(pluginManager);
    if (skillManager) {
      agent.setSkillManager(skillManager);
    }

    let mcpManager: MCPClientManager | null = null;
    if (config.mcp && Object.keys(config.mcp).length > 0) {
      mcpManager = new MCPClientManager();
      await mcpManager.connect(config.mcp);

      const mcpTools = mcpManager.getTools();
      for (const tool of mcpTools) {
        toolRegistry.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          execute: async (params: any) => {
            return mcpManager!.callTool(tool.name, params);
          },
          source: 'mcp' as ToolSource
        }, 'mcp');
      }
      log.info(`MCP tools loaded: ${mcpTools.length}`);
    }

    registerCronTools(toolRegistry, cronService, eventBus);

    const apiServer = new APIServer(
      port,
      agent,
      sessionManager,
      channelManager,
      config,
      pluginManager,
      cronService,
      mcpManager ?? undefined
    );
    await apiServer.start();
    log.info(`API server started on port ${port}`);

    return {
      eventBus,
      provider,
      toolRegistry,
      sessionManager,
      channelManager,
      pluginManager,
      agent,
      cronService,
      mcpManager,
      skillManager,
      config,
      workspace,
      apiServer
    };
  }
}
