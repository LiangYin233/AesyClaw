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
import { CommandRegistry, SessionCommands } from '../agent/commands/index.js';
import { APIServer } from '../api/index.js';
import { CronService } from '../cron/index.js';
import { registerCronTools } from '../cron/CronTools.js';
import { ConfigLoader } from '../config/loader.js';
import { logger } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';
import type { Config, OutboundMessage } from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import type { CronJob } from '../cron/index.js';

export interface Services {
  eventBus: EventBus;
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  channelManager: ChannelManager;
  pluginManager: PluginManager;
  agent: AgentLoop;
  cronService: CronService;
  mcpManager: MCPClientManager | null;
  skillManager: SkillManager | null;
  config: Config;
  workspace: string;
  apiServer?: APIServer;
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

export async function createServices(options: ServiceFactoryOptions): Promise<Services> {
  const { workspace, config, port, onCronJob } = options;
  const log = logger.child({ prefix: 'AesyClaw' });

  // 配置日志和指标
  logger.setLevel(config.log?.level || 'info');
  if (config.metrics?.enabled !== undefined) {
    metrics.setEnabled(config.metrics.enabled);
  }

  log.info('Initializing services...');

  // 1. 无依赖的基础服务
  const eventBus = new EventBus();
  const toolRegistry = new ToolRegistry();
  const providerConfig = config.providers[config.agent.defaults.provider];
  const provider = createProvider(config.agent.defaults.provider, providerConfig);

  // 2. SessionManager (依赖 workspace)
  const sessionManager = new SessionManager(
    join(workspace, '.aesyclaw', 'sessions'),
    config.agent.defaults.maxSessions ?? 100
  );
  await sessionManager.ready();
  await sessionManager.loadAll();
  log.info(`SessionManager ready, ${sessionManager.count()} sessions loaded`);

  // 3. SkillManager
  const skillManager = new SkillManager('./skills');
  skillManager.setConfig(config);
  await skillManager.loadFromDirectory();
  log.info(`SkillManager initialized with ${skillManager.listSkills().length} skills`);

  // 4. AgentLoop (依赖 eventBus, provider, toolRegistry, sessionManager, skillManager)
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
    skillManager
  );

  // 初始化命令注册表
  const commandRegistry = new CommandRegistry();
  const sessionCommands = new SessionCommands(
    sessionManager,
    (agent as any).channelSessions  // 访问私有字段
  );
  commandRegistry.registerHandler(sessionCommands);
  agent.setCommandRegistry(commandRegistry);
  log.info('Command registry initialized with session commands');

  // 5. PluginManager (依赖 agent, toolRegistry, eventBus)
  const pluginManager = new PluginManager(
    {
      config,
      eventBus,
      agent,
      workspace,
      registerTool: (tool) => toolRegistry.register(tool as any),
      getToolRegistry: () => toolRegistry as any,
      logger,
      sendMessage: async (channel, chatId, content, messageType) => {
        let msg: OutboundMessage = {
          channel,
          chatId,
          content,
          messageType: messageType || 'private'
        };
        // Apply onResponse hooks for consistency
        msg = await pluginManager.applyOnResponse(msg) || msg;
        await eventBus.publishOutbound(msg);
      }
    },
    toolRegistry
  );

  if (config.plugins) {
    pluginManager.setPluginConfigs(config.plugins as Record<string, { enabled: boolean; options?: Record<string, any> }>);
  }

  const newPluginConfigs = await pluginManager.applyDefaultConfigs();
  if (Object.keys(newPluginConfigs).length > 0) {
    config.plugins = newPluginConfigs;
    await ConfigLoader.save(config);
    log.info('Applied default plugin configs');
  }

  if (config.plugins && Object.keys(config.plugins).length > 0) {
    await pluginManager.loadFromConfig(config.plugins);
  }

  agent.setPluginManager(pluginManager);

  // 6. CronService
  const cronService = new CronService(
    join(workspace, '.aesyclaw', 'cron-jobs.json'),
    onCronJob || (async () => {})
  );
  await cronService.start();

  // 7. ChannelManager
  const channelManager = new ChannelManager(eventBus);
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

  // 8. MCP (可选，非阻塞)
  let mcpManager: MCPClientManager | null = null;
  if (config.mcp && Object.keys(config.mcp).length > 0) {
    mcpManager = new MCPClientManager();
    mcpManager.connectAsync(config.mcp);
    log.info('MCP servers connecting in background...');

    mcpManager.onToolsLoaded((tools) => {
      log.debug(`MCP tools loaded callback triggered, tools count: ${tools.length}`);
      for (const tool of tools) {
        const toolName = tool.name;
        log.debug(`Registering MCP tool: ${toolName}`);
        toolRegistry.register({
          name: toolName,
          description: tool.description,
          parameters: tool.parameters,
          execute: async (params: any, context?: any) => {
            return mcpManager!.callTool(toolName, params);
          },
          source: 'mcp' as ToolSource
        }, 'mcp');
      }
      log.info(`MCP tools registered: ${tools.length}`);
    });
  }

  // 9. 注册内置工具
  registerCronTools(toolRegistry, cronService, eventBus);

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

  const skills = skillManager.listSkills();
  if (skills.length > 0) {
    log.info(`Registered skill tools. Available skills: ${skills.map(s => s.name).join(', ')}`);
  }

  // 10. APIServer (conditional)
  let apiServer: APIServer | undefined;
  if (config.server.apiEnabled !== false) {
    apiServer = new APIServer(
      port,
      agent,
      sessionManager,
      channelManager,
      config,
      pluginManager,
      cronService,
      mcpManager ?? undefined,
      skillManager,
      toolRegistry
    );
    await apiServer.start();
    log.info(`API server started on port ${port}`);
  } else {
    log.info('API server disabled by configuration');
  }

  log.info('All services initialized successfully');

  return {
    eventBus, provider, toolRegistry, sessionManager, channelManager,
    pluginManager, agent, cronService, mcpManager, skillManager,
    config, workspace, apiServer
  };
}
