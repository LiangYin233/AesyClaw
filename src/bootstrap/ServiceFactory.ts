import { join } from 'path';
import { Container, TOKENS } from '../di/index.js';
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
import { metrics } from '../logger/Metrics.js';
import type { Config } from '../types.js';
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
  apiServer: APIServer;
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

/**
 * Service Factory using Dependency Injection
 *
 * Creates and configures all services using a DI container.
 * This eliminates circular dependencies and makes the initialization order explicit.
 */
export class ServiceFactory {
  private log = logger.child({ prefix: 'ServiceFactory' });

  async create(options: ServiceFactoryOptions): Promise<Services> {
    const { workspace, config, port, onCronJob } = options;

    // 配置日志系统
    logger.setLevel(config.log?.level || 'info');
    const log = logger.child({ prefix: 'AesyClaw' });

    // 配置指标收集系统
    if (config.metrics) {
      if (config.metrics.enabled !== undefined) {
        metrics.setEnabled(config.metrics.enabled);
      }
      log.info(`Metrics collection: ${metrics.isEnabled() ? 'enabled' : 'disabled'}`);
      if (metrics.isEnabled()) {
        log.info(`Metrics max size: ${config.metrics.maxMetrics || 10000}`);
      }
    }

    log.info('Initializing services with DI container...');

    const container = new Container();

    // Register configuration and workspace
    container.registerInstance(TOKENS.Config, config);
    container.registerInstance(TOKENS.Workspace, workspace);

    // Register EventBus
    container.registerSingleton(TOKENS.EventBus, () => {
      log.debug('Creating EventBus');
      return new EventBus();
    });

    // Register LLM Provider
    container.registerSingleton(TOKENS.LLMProvider, () => {
      log.debug('Creating LLM Provider');
      const providerConfig = config.providers[config.agent.defaults.provider];
      return createProvider(config.agent.defaults.provider, providerConfig);
    });

    // Register ToolRegistry
    container.registerSingleton(TOKENS.ToolRegistry, () => {
      log.debug('Creating ToolRegistry');
      return new ToolRegistry();
    });

    // Register SessionManager
    container.registerSingleton(TOKENS.SessionManager, async (c) => {
      log.debug('Creating SessionManager');
      const ws = await c.resolve<string>(TOKENS.Workspace);
      const cfg = await c.resolve<Config>(TOKENS.Config);
      const sessionManager = new SessionManager(
        join(ws, '.aesyclaw', 'sessions'),
        cfg.agent.defaults.maxSessions ?? 100
      );
      await sessionManager.ready();
      await sessionManager.loadAll();
      log.info(`SessionManager ready, ${sessionManager.count()} sessions loaded`);
      return sessionManager;
    });

    // Register SkillManager
    container.registerSingleton(TOKENS.SkillManager, async (c) => {
      log.debug('Creating SkillManager');
      const cfg = await c.resolve<Config>(TOKENS.Config);
      const skillManager = new SkillManager('./skills');
      skillManager.setConfig(cfg);
      await skillManager.loadFromDirectory();
      log.info(`SkillManager initialized with ${skillManager.listSkills().length} skills`);
      return skillManager;
    });

    // Register AgentLoop (depends on EventBus, Provider, ToolRegistry, SessionManager, SkillManager)
    container.registerSingleton(TOKENS.AgentLoop, async (c) => {
      log.debug('Creating AgentLoop');
      const eventBus = await c.resolve<EventBus>(TOKENS.EventBus);
      const provider = await c.resolve<LLMProvider>(TOKENS.LLMProvider);
      const toolRegistry = await c.resolve<ToolRegistry>(TOKENS.ToolRegistry);
      const sessionManager = await c.resolve<SessionManager>(TOKENS.SessionManager);
      const ws = await c.resolve<string>(TOKENS.Workspace);
      const cfg = await c.resolve<Config>(TOKENS.Config);
      const skillManager = await c.resolve<SkillManager>(TOKENS.SkillManager);

      const agent = new AgentLoop(
        eventBus,
        provider,
        toolRegistry,
        sessionManager,
        ws,
        cfg.agent.defaults.systemPrompt,
        cfg.agent.defaults.maxToolIterations,
        cfg.agent.defaults.model,
        cfg.agent.defaults.contextMode,
        cfg.agent.defaults.memoryWindow,
        skillManager
      );

      return agent;
    });

    // Register PluginManager (depends on AgentLoop, ToolRegistry, EventBus)
    // This is where we break the circular dependency - PluginManager gets AgentLoop from container
    container.registerSingleton(TOKENS.PluginManager, async (c) => {
      log.debug('Creating PluginManager');
      const cfg = await c.resolve<Config>(TOKENS.Config);
      const eventBus = await c.resolve<EventBus>(TOKENS.EventBus);
      const agent = await c.resolve<AgentLoop>(TOKENS.AgentLoop);
      const toolRegistry = await c.resolve<ToolRegistry>(TOKENS.ToolRegistry);
      const ws = await c.resolve<string>(TOKENS.Workspace);

      const pluginManager = new PluginManager(
        {
          config: cfg,
          eventBus,
          agent: agent,  // No more null! DI container resolves the dependency
          workspace: ws,
          registerTool: (tool) => toolRegistry.register(tool as any),
          getToolRegistry: () => toolRegistry as any,
          logger,
          sendMessage: async (channel, chatId, content, messageType) => {
            await eventBus.publishOutbound({ channel, chatId, content, messageType: messageType || 'private' });
          }
        },
        toolRegistry
      );

      // Set plugin configs
      if (cfg.plugins) {
        pluginManager.setPluginConfigs(cfg.plugins as Record<string, { enabled: boolean; options?: Record<string, any> }>);
      }

      // Apply default configs
      const newPluginConfigs = await pluginManager.applyDefaultConfigs();
      if (Object.keys(newPluginConfigs).length > 0) {
        cfg.plugins = newPluginConfigs;
        const { ConfigLoader } = await import('../config/loader.js');
        await ConfigLoader.save(cfg);
        log.info('Applied default plugin configs');
      }

      // Load plugins from config
      if (cfg.plugins && Object.keys(cfg.plugins).length > 0) {
        await pluginManager.loadFromConfig(cfg.plugins);
      }

      // Wire up the bidirectional reference
      agent.setPluginManager(pluginManager);

      return pluginManager;
    });

    // Register CronService
    container.registerSingleton(TOKENS.CronService, async (c) => {
      log.debug('Creating CronService');
      const ws = await c.resolve<string>(TOKENS.Workspace);
      const cronService = new CronService(
        join(ws, '.aesyclaw', 'cron-jobs.json'),
        onCronJob || (async () => {})
      );
      await cronService.start();
      log.debug('CronService started');
      return cronService;
    });

    // Register ChannelManager
    container.registerSingleton(TOKENS.ChannelManager, async (c) => {
      log.debug('Creating ChannelManager');
      const eventBus = await c.resolve<EventBus>(TOKENS.EventBus);
      const cfg = await c.resolve<Config>(TOKENS.Config);
      const channelManager = new ChannelManager(eventBus);

      // Create channels from config
      for (const [channelName, channelConfig] of Object.entries(cfg.channels)) {
        if (channelConfig?.enabled) {
          const channel = channelManager.createChannel(channelName, channelConfig);
          if (channel) {
            log.info(`Channel enabled: ${channelName}`);
          } else {
            log.warn(`Channel plugin not found: ${channelName}`);
          }
        }
      }

      return channelManager;
    });

    // Register MCPClientManager (optional)
    container.registerSingleton(TOKENS.MCPClientManager, async (c) => {
      const cfg = await c.resolve<Config>(TOKENS.Config);
      if (!cfg.mcp || Object.keys(cfg.mcp).length === 0) {
        return null;
      }

      log.debug('Creating MCPClientManager');
      const mcpManager = new MCPClientManager();

      // 非阻塞连接 - 立即返回,后台连接
      mcpManager.connectAsync(cfg.mcp);

      log.info('MCP servers connecting in background...');

      // 注册工具加载回调
      // 当 MCP 工具加载完成时,动态注册到 ToolRegistry
      const toolRegistry = await c.resolve<ToolRegistry>(TOKENS.ToolRegistry);
      mcpManager.onToolsLoaded((tools) => {
        for (const tool of tools) {
          toolRegistry.register({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            execute: async (params: any) => {
              return mcpManager.callTool(tool.name, params);
            },
            source: 'mcp' as ToolSource
          }, 'mcp');
        }
        log.info(`MCP tools registered: ${tools.length}`);
      });

      return mcpManager;
    });

    // Register cron tools
    const toolRegistry = await container.resolve<ToolRegistry>(TOKENS.ToolRegistry);
    const cronService = await container.resolve<CronService>(TOKENS.CronService);
    const eventBus = await container.resolve<EventBus>(TOKENS.EventBus);
    registerCronTools(toolRegistry, cronService, eventBus);

    // Register skill tools
    const skillManager = await container.resolve<SkillManager>(TOKENS.SkillManager);
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
        const content = await skillManager.readSkillFile(skillName, fileName);
        return content || `Skill "${skillName}" or file not found`;
      }
    }, 'built-in' as ToolSource);

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
        const files = await skillManager.listSkillFiles(skillName);
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

    const skills = skillManager.listSkills();
    if (skills.length > 0) {
      const skillNames = skills.map(s => s.name).join(', ');
      log.info(`Registered read_skill, list_skill_files tools. Available skills: ${skillNames}`);
    }

    // Register APIServer
    container.registerSingleton(TOKENS.APIServer, async (c) => {
      log.debug('Creating APIServer');
      const agent = await c.resolve<AgentLoop>(TOKENS.AgentLoop);
      const sessionManager = await c.resolve<SessionManager>(TOKENS.SessionManager);
      const channelManager = await c.resolve<ChannelManager>(TOKENS.ChannelManager);
      const cfg = await c.resolve<Config>(TOKENS.Config);
      const pluginManager = await c.resolve<PluginManager>(TOKENS.PluginManager);
      const cronService = await c.resolve<CronService>(TOKENS.CronService);
      const mcpManager = await c.resolve<MCPClientManager | null>(TOKENS.MCPClientManager);
      const skillManager = await c.resolve<SkillManager>(TOKENS.SkillManager);
      const toolRegistry = await c.resolve<ToolRegistry>(TOKENS.ToolRegistry);

      const apiServer = new APIServer(
        port,
        agent,
        sessionManager,
        channelManager,
        cfg,
        pluginManager,
        cronService,
        mcpManager ?? undefined,
        skillManager,
        toolRegistry
      );
      await apiServer.start();
      log.info(`API server started on port ${port}`);

      return apiServer;
    });

    // Resolve all services
    const services: Services = {
      eventBus: await container.resolve(TOKENS.EventBus),
      provider: await container.resolve(TOKENS.LLMProvider),
      toolRegistry: await container.resolve(TOKENS.ToolRegistry),
      sessionManager: await container.resolve(TOKENS.SessionManager),
      channelManager: await container.resolve(TOKENS.ChannelManager),
      pluginManager: await container.resolve(TOKENS.PluginManager),
      agent: await container.resolve(TOKENS.AgentLoop),
      cronService: await container.resolve(TOKENS.CronService),
      mcpManager: await container.resolve(TOKENS.MCPClientManager),
      skillManager: await container.resolve(TOKENS.SkillManager),
      config,
      workspace,
      apiServer: await container.resolve(TOKENS.APIServer)
    };

    log.info('All services initialized successfully');

    return services;
  }
}
