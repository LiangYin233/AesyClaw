import { join } from 'path';
import { EventBus } from '../../bus/EventBus.js';
import { AgentLoop, SessionRoutingService } from '../../agent/index.js';
import { ChannelManager } from '../../channels/index.js';
import { createProvider, createProviderFromConfig } from '../../providers/index.js';
import { ToolRegistry } from '../../tools/index.js';
import type { Tool } from '../../tools/ToolRegistry.js';
import { MemoryFactStore, SessionManager } from '../../session/index.js';
import { MCPClientManager } from '../../mcp/index.js';
import { PluginManager } from '../../plugins/index.js';
import type { PluginContext } from '../../plugins/PluginManager.js';
import { SkillManager } from '../../skills/index.js';
import { CommandRegistry, SessionCommands } from '../../agent/commands/index.js';
import { APIServer } from '../../api/index.js';
import { CronService } from '../../cron/index.js';
import { ConfigLoader } from '../../config/loader.js';
import { logger } from '../../logger/index.js';
import { metrics } from '../../logger/Metrics.js';
import { tokenStats } from '../../logger/TokenStats.js';
import { SessionMemoryService } from '../../agent/memory/SessionMemoryService.js';
import type { Config, OutboundMessage, VisionSettings } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { CronJob } from '../../cron/index.js';
import { registerBuiltInTools, registerMcpTools } from './ToolIntegrationService.js';

const appLog = logger.child({ prefix: 'AesyClaw' });

export interface Services {
  eventBus: EventBus;
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  memoryFactStore: MemoryFactStore;
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

type ResolvedProviderConfig = {
  name: string;
  model: string;
  providerConfig?: Config['providers'][string];
};

function resolveProviderConfig(config: Config, providerName?: string, modelName?: string): ResolvedProviderConfig {
  const name = providerName || config.agent.defaults.provider;
  const providerConfig = config.providers[name];

  return {
    name,
    model: modelName || providerConfig?.model || config.agent.defaults.model,
    providerConfig
  };
}

function createOptionalProvider(resolved: ResolvedProviderConfig, label: string): LLMProvider | undefined {
  if (!resolved.providerConfig) {
    appLog.warn(`${label} provider "${resolved.name}" not found in config`);
    return undefined;
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

function createRequiredProvider(resolved: ResolvedProviderConfig, label: string): LLMProvider {
  if (!resolved.providerConfig) {
    throw new Error(`${label} provider "${resolved.name}" not found in config`);
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

function createVisionProvider(config: Config, visionSettings: VisionSettings): LLMProvider | undefined {
  if (!visionSettings.visionProviderName) {
    return undefined;
  }

  const providerConfig = config.providers[visionSettings.visionProviderName];
  if (!providerConfig) {
    appLog.warn(`Vision provider "${visionSettings.visionProviderName}" not found in config`);
    return undefined;
  }

  appLog.info(`Vision provider created: ${visionSettings.visionProviderName}, model: ${visionSettings.visionModelName || 'default'}`);
  return createProviderFromConfig(providerConfig);
}

function configureRuntime(config: Config): void {
  logger.setLevel(config.log?.level || 'info');
  if (config.metrics?.enabled !== undefined) {
    metrics.setEnabled(config.metrics.enabled);
  }
  tokenStats.setDataDir(join(process.cwd(), '.aesyclaw'));
}

async function createSessionServices(config: Config): Promise<{
  sessionManager: SessionManager;
  memoryFactStore: MemoryFactStore;
  memoryService?: SessionMemoryService;
  sessionRouting: SessionRoutingService;
}> {
  const sessionManager = new SessionManager(
    join(process.cwd(), '.aesyclaw', 'sessions'),
    config.agent.defaults.maxSessions ?? 100
  );
  await sessionManager.loadAll();
  appLog.info(`SessionManager ready, ${sessionManager.count()} sessions loaded`);

  const memoryFactStore = new MemoryFactStore(sessionManager.getDatabase());
  const memoryService = createMemoryService(config, sessionManager, memoryFactStore);
  if (memoryService) {
    appLog.info('Memory service enabled');
  }

  return {
    sessionManager,
    memoryFactStore,
    memoryService,
    sessionRouting: new SessionRoutingService(sessionManager, config.agent.defaults.contextMode)
  };
}

async function createSkillManager(config: Config): Promise<SkillManager> {
  const skillManager = new SkillManager('./skills');
  skillManager.setConfig(config);
  await skillManager.loadFromDirectory();
  appLog.info(`SkillManager initialized with ${skillManager.listSkills().length} skills`);
  return skillManager;
}

async function createPluginManager(args: {
  config: Config;
  eventBus: EventBus;
  agent: AgentLoop;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
}): Promise<PluginManager> {
  const { config, eventBus, agent, workspace, tempDir, toolRegistry } = args;
  let pluginManager!: PluginManager;

  const pluginContext: PluginContext = {
    config,
    eventBus,
    agent,
    workspace,
    tempDir,
    registerTool: (tool: Tool) => toolRegistry.register(tool),
    getToolRegistry: () => toolRegistry,
    logger,
    sendMessage: async (
      channel: string,
      chatId: string,
      content: string,
      messageType?: 'private' | 'group'
    ) => {
      let message: OutboundMessage = {
        channel,
        chatId,
        content,
        messageType: messageType || 'private'
      };

      message = await pluginManager.applyOnResponse(message) || message;
      await eventBus.publishOutbound(message);
    }
  };

  pluginManager = new PluginManager(pluginContext, toolRegistry);

  if (config.plugins) {
    pluginManager.setPluginConfigs(config.plugins as Record<string, { enabled: boolean; options?: Record<string, any> }>);
  }

  const newPluginConfigs = await pluginManager.applyDefaultConfigs();
  if (Object.keys(newPluginConfigs).length > 0) {
    config.plugins = newPluginConfigs;
    await ConfigLoader.save(config);
    appLog.info('Applied default plugin configs');
  }

  if (config.plugins && Object.keys(config.plugins).length > 0) {
    await pluginManager.loadFromConfig(config.plugins);
  }

  return pluginManager;
}

function createChannelManager(config: Config, eventBus: EventBus, workspace: string): ChannelManager {
  const channelManager = new ChannelManager(eventBus, workspace);

  for (const [channelName, channelConfig] of Object.entries(config.channels as Record<string, { enabled?: boolean }>)) {
    if (!channelConfig?.enabled) {
      continue;
    }

    const channel = channelManager.createChannel(channelName, channelConfig);
    if (channel) {
      appLog.info(`Channel enabled: ${channelName}`);
    } else {
      appLog.warn(`Channel plugin not found: ${channelName}`);
    }
  }

  return channelManager;
}

function createMcpManager(config: Config, toolRegistry: ToolRegistry): MCPClientManager | null {
  if (!config.mcp || Object.keys(config.mcp).length === 0) {
    return null;
  }

  const mcpManager = new MCPClientManager();
  registerMcpTools(toolRegistry, mcpManager);
  mcpManager.connectAsync(config.mcp);
  appLog.info('MCP servers connecting in background...');
  return mcpManager;
}

async function createOptionalApiServer(args: {
  config: Config;
  port: number;
  agent: AgentLoop;
  sessionManager: SessionManager;
  channelManager: ChannelManager;
  pluginManager: PluginManager;
  cronService: CronService;
  mcpManager: MCPClientManager | null;
  skillManager: SkillManager | null;
  toolRegistry: ToolRegistry;
  memoryFactStore: MemoryFactStore;
}): Promise<APIServer | undefined> {
  const { config, port, agent, sessionManager, channelManager, pluginManager, cronService, mcpManager, skillManager, toolRegistry, memoryFactStore } = args;

  if (config.server.apiEnabled === false) {
    appLog.info('API server disabled by configuration');
    return undefined;
  }

  const apiServer = new APIServer(
    port,
    agent,
    sessionManager,
    channelManager,
    config,
    pluginManager,
    cronService,
    mcpManager ?? undefined,
    skillManager ?? undefined,
    toolRegistry,
    memoryFactStore
  );
  await apiServer.start();
  appLog.info(`API server started on port ${port}`);
  return apiServer;
}

function applyToolBlacklist(config: Config, toolRegistry: ToolRegistry): void {
  if (config.tools?.blacklist && config.tools.blacklist.length > 0) {
    toolRegistry.setBlacklist(config.tools.blacklist);
    appLog.info(`Tool blacklist applied: ${config.tools.blacklist.join(', ')}`);
  }
}

export function createMemoryService(
  config: Config,
  sessionManager: SessionManager,
  factsStore: MemoryFactStore
): SessionMemoryService | undefined {
  const summaryConfig = config.agent.defaults.memorySummary;
  const factsConfig = config.agent.defaults.memoryFacts;

  if (!summaryConfig?.enabled && !factsConfig?.enabled) {
    return undefined;
  }

  const summaryProviderConfig = resolveProviderConfig(config, summaryConfig?.provider, summaryConfig?.model);
  const factsProviderConfig = resolveProviderConfig(config, factsConfig?.provider, factsConfig?.model);

  const summaryRuntimeConfig = {
    enabled: summaryConfig?.enabled === true,
    model: summaryProviderConfig.model,
    triggerMessages: summaryConfig?.triggerMessages ?? 20,
    memoryWindow: config.agent.defaults.memoryWindow
  };
  const factsRuntimeConfig = {
    enabled: factsConfig?.enabled === true,
    model: factsProviderConfig.model,
    maxFacts: factsConfig?.maxFacts ?? 20
  };

  return new SessionMemoryService(
    sessionManager,
    factsStore,
    summaryConfig?.enabled ? createOptionalProvider(summaryProviderConfig, 'Memory summary') : undefined,
    summaryRuntimeConfig,
    factsConfig?.enabled ? createOptionalProvider(factsProviderConfig, 'Memory facts') : undefined,
    factsRuntimeConfig
  );
}

export async function createServices(options: ServiceFactoryOptions): Promise<Services> {
  const { workspace, tempDir, config, port, onCronJob } = options;
  const log = appLog;

  configureRuntime(config);

  log.info('Initializing services...');

  const eventBus = new EventBus();
  const toolRegistry = new ToolRegistry({
    defaultTimeout: config.tools?.timeoutMs
  });
  const provider = createRequiredProvider(resolveProviderConfig(config), 'Default');

  const agentDefaults = config.agent.defaults;
  const visionSettings: VisionSettings = {
    enabled: agentDefaults.vision || false,
    reasoning: agentDefaults.reasoning || false,
    visionProviderName: agentDefaults.visionProvider,
    visionModelName: agentDefaults.visionModel
  };
  const visionProvider = createVisionProvider(config, visionSettings);
  const {
    sessionManager,
    memoryFactStore,
    memoryService,
    sessionRouting
  } = await createSessionServices(config);
  const skillManager = await createSkillManager(config);

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
    sessionRouting,
    memoryService
  );

  const commandRegistry = new CommandRegistry();
  const sessionCommands = new SessionCommands(sessionManager, sessionRouting);
  commandRegistry.registerHandler(sessionCommands);
  eventBus.setStopHandler((channel: string, chatId: string) => agent.abortSession(channel, chatId));
  agent.setCommandRegistry(commandRegistry);
  log.info('Command registry initialized');
  const pluginManager = await createPluginManager({
    config,
    eventBus,
    agent,
    workspace,
    tempDir,
    toolRegistry
  });

  agent.setPluginManager(pluginManager);

  const cronService = new CronService(
    join(process.cwd(), '.aesyclaw', 'cron-jobs.json'),
    onCronJob || (async () => {})
  );
  await cronService.start();
  const channelManager = createChannelManager(config, eventBus, workspace);
  const mcpManager = createMcpManager(config, toolRegistry);

  registerBuiltInTools({
    toolRegistry,
    skillManager,
    cronService,
    eventBus,
    pluginManager,
    mcpManager
  });
  const apiServer = await createOptionalApiServer({
    config,
    port,
    agent,
    sessionManager,
    channelManager,
    pluginManager,
    cronService,
    mcpManager,
    skillManager,
    toolRegistry,
    memoryFactStore
  });

  applyToolBlacklist(config, toolRegistry);

  log.info('All services initialized successfully');

  return {
    eventBus,
    provider,
    toolRegistry,
    sessionManager,
    memoryFactStore,
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
