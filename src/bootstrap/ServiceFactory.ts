import { join } from 'path';
import { EventBus } from '../bus/EventBus.js';
import { AgentLoop, SessionRoutingService } from '../agent/index.js';
import { ChannelManager } from '../channels/index.js';
import { createProvider, createProviderFromConfig } from '../providers/index.js';
import { ToolRegistry } from '../tools/index.js';
import type { ToolSource } from '../tools/ToolRegistry.js';
import { SessionManager } from '../session/index.js';
import { MCPClientManager } from '../mcp/index.js';
import { PluginManager } from '../plugins/index.js';
import { SkillManager } from '../skills/index.js';
import { CommandRegistry, SessionCommands } from '../agent/commands/index.js';
import { APIServer } from '../api/index.js';
import { CronService } from '../cron/index.js';
import { ConfigLoader } from '../config/loader.js';
import { logger } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';
import { tokenStats } from '../logger/TokenStats.js';
import type { Config, OutboundMessage, VisionSettings } from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import type { CronJob } from '../cron/index.js';
import { registerBuiltInTools, registerMcpTools } from './ToolIntegrationService.js';

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
  tempDir: string;
  config: Config;
  port: number;
  onCronJob?: (job: CronJob) => Promise<void>;
}

export async function createServices(options: ServiceFactoryOptions): Promise<Services> {
  const { workspace, tempDir, config, port, onCronJob } = options;
  const log = logger.child({ prefix: 'AesyClaw' });

  // 配置日志和指标
  logger.setLevel(config.log?.level || 'info');
  if (config.metrics?.enabled !== undefined) {
    metrics.setEnabled(config.metrics.enabled);
  }
  tokenStats.setDataDir(join(process.cwd(), '.aesyclaw'));

  log.info('Initializing services...');

  // 1. 无依赖的基础服务
  const eventBus = new EventBus();
  const toolRegistry = new ToolRegistry();
  const providerConfig = config.providers[config.agent.defaults.provider];
  const provider = createProvider(config.agent.defaults.provider, providerConfig);

  // 读取视觉配置
  const agentDefaults = config.agent.defaults;
  const visionSettings: VisionSettings = {
    enabled: agentDefaults.vision || false,
    reasoning: agentDefaults.reasoning || false,
    visionProviderName: agentDefaults.visionProvider,
    visionModelName: agentDefaults.visionModel
  };

  // 创建视觉模型提供商（如果配置了 visionProvider）
  // vision: false 表示当前模型无视觉能力，需要转发给视觉模型
  let visionProvider: LLMProvider | undefined;
  if (visionSettings.visionProviderName) {
    const visionProviderConfig = config.providers[visionSettings.visionProviderName];
    if (visionProviderConfig) {
      visionProvider = createProviderFromConfig(visionProviderConfig);
      log.info(`Vision provider created: ${visionSettings.visionProviderName}, model: ${visionSettings.visionModelName || 'default'}`);
    } else {
      log.warn(`Vision provider "${visionSettings.visionProviderName}" not found in config`);
    }
  }

  // 2. SessionManager (依赖 workspace)
  const sessionManager = new SessionManager(
    join(process.cwd(), '.aesyclaw', 'sessions'),
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

  const sessionRouting = new SessionRoutingService(sessionManager, config.agent.defaults.contextMode);

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
    skillManager,
    visionSettings,
    visionProvider,
    sessionRouting
  );

  // 初始化命令注册表
  const commandRegistry = new CommandRegistry();
  const sessionCommands = new SessionCommands(
    sessionManager,
    sessionRouting
  );
  commandRegistry.registerHandler(sessionCommands);

  // 设置 EventBus 的 stop 命令处理器（用于立即中断）
  eventBus.setStopHandler((channel, chatId) => agent.abortSession(channel, chatId));

  agent.setCommandRegistry(commandRegistry);
  log.info('Command registry initialized');

  // 5. PluginManager (依赖 agent, toolRegistry, eventBus)
  const pluginManager = new PluginManager(
    {
      config,
      eventBus,
      agent,
      workspace,
      tempDir,
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
    join(process.cwd(), '.aesyclaw', 'cron-jobs.json'),
    onCronJob || (async () => {})
  );
  await cronService.start();

  // 7. ChannelManager
  const channelManager = new ChannelManager(eventBus, workspace);
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
    registerMcpTools(toolRegistry, mcpManager);
    mcpManager.connectAsync(config.mcp);
    log.info('MCP servers connecting in background...');
  }

  // 9. 注册内置工具
  registerBuiltInTools({
    toolRegistry,
    skillManager,
    cronService,
    eventBus,
    pluginManager,
    mcpManager
  });

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

  // 11. 应用工具黑名单
  if (config.tools?.blacklist && config.tools.blacklist.length > 0) {
    toolRegistry.setBlacklist(config.tools.blacklist);
    log.info(`Tool blacklist applied: ${config.tools.blacklist.join(', ')}`);
  }

  log.info('All services initialized successfully');

  return {
    eventBus, provider, toolRegistry, sessionManager, channelManager,
    pluginManager, agent, cronService, mcpManager, skillManager,
    config, workspace, apiServer
  };
}
