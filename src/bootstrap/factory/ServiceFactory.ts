import { join } from 'path';
import { BuiltInCommands } from '../../agent/legacy-commands/index.js';
import {
  AgentRuntime,
  OutboundGateway,
  createLegacyCompatibleAgentRuntime
} from '../../agent/index.js';
import { LongTermMemoryService } from '../../agent/legacy-memory/LongTermMemoryService.js';
import { OpenAIEmbeddingsClient } from '../../agent/legacy-memory/OpenAIEmbeddingsClient.js';
import { SessionMemoryService } from '../../agent/legacy-memory/SessionMemoryService.js';
import { SessionRoutingService } from '../../agent/legacy-session/SessionRoutingService.js';
import { AgentRoleService } from '../../agent/legacy-roles/AgentRoleService.js';
import { APIServer } from '../../api/index.js';
import { ChannelManager } from '../../channels/ChannelManager.js';
import { loadExternalChannelPlugins } from '../../channels/ChannelPluginLoader.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { RuntimeConfigStore } from '../../config/RuntimeConfigStore.js';
import {
  getMainAgentConfig,
  getMemoryConfig,
  getSessionRuntimeConfig,
  getToolRuntimeConfig,
  listEmbeddingProviderNames,
  parseConfig,
  resolveProviderSelection
} from '../../config/index.js';
import { CronService } from '../../cron/index.js';
import { logging, logger, tokenUsage } from '../../observability/index.js';
import { createProvider } from '../../providers/index.js';
import type { LLMProvider } from '../../providers/base.js';
import { LongTermMemoryStore, SessionManager } from '../../session/index.js';
import { SkillManager } from '../../skills/index.js';
import { ToolRegistry, registerBuiltInTools } from '../../tools/index.js';
import { CommandRegistry } from '../../agent/legacy-commands/index.js';
import { MCPClientManager } from '../../mcp/index.js';
import { startConfiguredMcpServers } from '../../mcp/runtime.js';
import { PluginManager } from '../../plugins/index.js';
import type { PluginConfigState } from '../../plugins/index.js';
import type { Config, VisionSettings } from '../../types.js';
import type { ResolvedProviderSelection } from '../../config/schema.js';
import type { CronJob } from '../../cron/index.js';
import { normalizeBootstrapError } from './errors.js';
import { EventBus } from '../../events/EventBus.js';
import type { AesyClawEvents } from '../../events/events.js';

const appLog = logger.child('AesyClaw');

export interface Services {
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  sessionRouting: SessionRoutingService;
  channelManager: ChannelManager;
  pluginManager: PluginManager;
  startPluginLoading: () => void;
  isPluginLoadingComplete: () => boolean;
  agentRuntime: AgentRuntime;
  cronService: CronService;
  mcpManager: MCPClientManager | null;
  skillManager: SkillManager | null;
  config: Config;
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  eventBus: EventBus<AesyClawEvents>;
  workspace: string;
  apiServer?: APIServer;
}

export interface ServiceFactoryOptions {
  workspace: string;
  tempDir: string;
  config: Config;
  configManager: ConfigManager;
  eventBus: EventBus<AesyClawEvents>;
  port: number;
  onCronJob?: (job: CronJob) => Promise<void>;
}

function bootstrapRuntimeConfig(config: Config): Config {
  const resolved = parseConfig(config);
  logging.configure({
    level: resolved.observability.level
  });
  tokenUsage.configure({
    enabled: true,
    persistFile: join(process.cwd(), '.aesyclaw', 'token-usage.db')
  });
  return resolved;
}

function createOptionalProvider(resolved: ResolvedProviderSelection, label: string) {
  if (!resolved.providerConfig) {
    appLog.warn(`配置中未找到${label}提供商 "${resolved.name}"`);
    return undefined;
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

function createEmbeddingsClient(resolved: ResolvedProviderSelection | undefined): OpenAIEmbeddingsClient | undefined {
  if (!resolved?.providerConfig) {
    if (resolved?.name) {
      appLog.warn('未找到 embeddings 提供商', { provider: resolved.name });
    }
    return undefined;
  }

  if (!listEmbeddingProviderNames({ [resolved.name]: resolved.providerConfig }).length) {
    appLog.warn('embeddings 提供商必须为 openai 类型', {
      provider: resolved.name,
      type: resolved.providerConfig.type
    });
    return undefined;
  }

  return new OpenAIEmbeddingsClient({
    apiKey: resolved.providerConfig.apiKey,
    apiBase: resolved.providerConfig.apiBase,
    headers: resolved.providerConfig.headers
  });
}

export function createMemoryService(
  config: Config,
  sessionManager: SessionManager,
  longTermMemoryStore: LongTermMemoryStore
): SessionMemoryService | undefined {
  const memoryConfig = getMemoryConfig(config);
  const summaryConfig = memoryConfig.summary;
  const sessionConfig = memoryConfig.session;
  const maintenanceSelection = memoryConfig.facts.maintenance.provider && memoryConfig.facts.maintenance.model
    ? resolveProviderSelection(
        config,
        memoryConfig.facts.maintenance.provider,
        memoryConfig.facts.maintenance.model
      )
    : undefined;
  const recallSelection = memoryConfig.facts.recall.provider && memoryConfig.facts.recall.model
    ? resolveProviderSelection(
        config,
        memoryConfig.facts.recall.provider,
        memoryConfig.facts.recall.model
      )
    : undefined;

  if (!summaryConfig.enabled && !memoryConfig.facts.enabled) {
    return undefined;
  }

  if (!summaryConfig.enabled && config.agent.defaults.memorySummary.enabled) {
    appLog.warn('会话摘要已启用，但未完整配置 memorySummary.provider/model；摘要压缩将被跳过');
  }

  const summaryRuntimeConfig = {
    enabled: summaryConfig.enabled,
    model: summaryConfig.model,
    compressRounds: summaryConfig.compressRounds,
    memoryWindow: sessionConfig.memoryWindow,
    contextMode: sessionConfig.contextMode
  };

  if (memoryConfig.facts.enabled && !memoryConfig.facts.maintenance.enabled) {
    appLog.warn('长期记忆已启用，但未完整配置 memoryFacts.provider/model；后台自治维护将被跳过');
  }

  if (
    memoryConfig.facts.enabled
    && !memoryConfig.facts.recall.enabled
    && (config.agent.defaults.memoryFacts.retrievalProvider || config.agent.defaults.memoryFacts.retrievalModel)
  ) {
    appLog.warn('长期记忆自动召回需要同时配置 memoryFacts.retrievalProvider 与 memoryFacts.retrievalModel；当前将保持禁用');
  }

  const longTermMemoryService = memoryConfig.facts.enabled
    ? new LongTermMemoryService(
        sessionManager,
        longTermMemoryStore,
        {
          enabled: memoryConfig.facts.enabled,
          model: memoryConfig.facts.maintenance.model,
          retrievalProvider: memoryConfig.facts.recall.provider,
          retrievalModel: memoryConfig.facts.recall.model,
          retrievalThreshold: memoryConfig.facts.recall.threshold,
          retrievalTopK: memoryConfig.facts.recall.topK
        },
        maintenanceSelection
          ? createOptionalProvider(maintenanceSelection, '长期记忆')
          : undefined,
        recallSelection
          ? createEmbeddingsClient(recallSelection)
          : undefined
      )
    : undefined;

  return new SessionMemoryService(
    sessionManager,
    summaryConfig.enabled && summaryConfig.provider && summaryConfig.model
      ? createOptionalProvider(resolveProviderSelection(config, summaryConfig.provider, summaryConfig.model), '记忆摘要')
      : undefined,
    summaryRuntimeConfig,
    longTermMemoryService
  );
}

async function createPersistenceServices(config: Config): Promise<{
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  memoryService?: SessionMemoryService;
  sessionRouting: SessionRoutingService;
}> {
  const sessionConfig = getSessionRuntimeConfig(config);
  const sessionManager = new SessionManager(
    join(process.cwd(), '.aesyclaw', 'sessions'),
    sessionConfig.maxSessions
  );
  await sessionManager.loadAll();
  appLog.info(`会话管理器已就绪，已加载 ${sessionManager.count()} 个会话`);

  const longTermMemoryStore = new LongTermMemoryStore(sessionManager.getDatabase());
  const memoryService = createMemoryService(config, sessionManager, longTermMemoryStore);
  if (memoryService) {
    appLog.info('记忆服务已启用');
  }

  return {
    sessionManager,
    longTermMemoryStore,
    memoryService,
    sessionRouting: new SessionRoutingService(sessionManager, sessionConfig.contextMode)
  };
}

function createRequiredProvider(config: Config, providerName?: string, modelName?: string) {
  const resolved = resolveProviderSelection(config, providerName, modelName);
  if (!resolved.model) {
    throw new Error(`Model is required for provider "${resolved.name}"`);
  }
  if (!resolved.providerConfig) {
    throw new Error(`Provider "${resolved.name}" not found in config`);
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

function createVisionProvider(config: Config, visionSettings: VisionSettings) {
  if (visionSettings.enabled === false) {
    return undefined;
  }

  if (!visionSettings.visionProviderName) {
    appLog.warn('未配置视觉提供商', { provider: '', model: visionSettings.visionModelName });
    return undefined;
  }
  if (!visionSettings.visionModelName) {
    appLog.warn('未配置视觉模型', { provider: visionSettings.visionProviderName });
    return undefined;
  }

  const providerConfig = config.providers[visionSettings.visionProviderName];
  if (!providerConfig) {
    appLog.warn('未找到视觉提供商', { provider: visionSettings.visionProviderName });
    return undefined;
  }

  return createProvider(visionSettings.visionProviderName, providerConfig);
}

async function createSkillManager(
  config: Config,
  workspace: string,
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>
): Promise<SkillManager> {
  const skillManager = new SkillManager({
    builtinSkillsDir: './skills',
    externalSkillsDir: join(workspace, 'skills'),
    updateConfig
  });
  skillManager.setConfig(config);
  await skillManager.loadFromDirectory();
  await skillManager.startWatching();
  appLog.info('技能加载完成', { skillCount: skillManager.listSkills().length });
  return skillManager;
}

async function createExecutionRuntime(args: {
  getConfig: () => Config;
  setConfig: (config: Config) => void;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
  eventBus: EventBus<AesyClawEvents>;
  outboundGateway: OutboundGateway;
  workspace: string;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  memoryService?: SessionMemoryService;
}): Promise<{
  provider: ReturnType<typeof createRequiredProvider>;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  skillManager: SkillManager;
  agentRoleService: AgentRoleService;
  agentRuntime: AgentRuntime;
  visionSettings: VisionSettings;
  visionProvider?: ReturnType<typeof createVisionProvider>;
  setPluginManager: (pluginManager: PluginManager) => void;
}> {
  const { getConfig, setConfig, updateConfig, eventBus, outboundGateway, workspace, sessionManager, sessionRouting, memoryService } = args;
  const config = getConfig();
  const toolConfig = getToolRuntimeConfig(config);
  const mainAgentConfig = getMainAgentConfig(config);
  const toolRegistry = new ToolRegistry({
    defaultTimeout: toolConfig.timeoutMs
  });
  const commandRegistry = new CommandRegistry();
  const provider = createRequiredProvider(config, mainAgentConfig.role.provider, mainAgentConfig.role.model);
  const visionSettings = mainAgentConfig.visionSettings;
  const visionProvider = createVisionProvider(config, visionSettings);
  const skillManager = await createSkillManager(config, workspace, updateConfig);
  const agentRoleService = new AgentRoleService(
    getConfig,
    setConfig,
    updateConfig,
    toolRegistry,
    skillManager
  );

  let pluginManagerRef: PluginManager | undefined;
  const agentRuntime = await createLegacyCompatibleAgentRuntime({
    provider,
    toolRegistry,
    sessionManager,
    commandRegistry,
    sessionRouting,
    outboundGateway,
    workspace,
    systemPrompt: mainAgentConfig.role.systemPrompt,
    maxIterations: mainAgentConfig.maxIterations,
    model: mainAgentConfig.role.model,
    memoryWindow: mainAgentConfig.memoryWindow,
    visionSettings,
    visionProvider,
    memoryService,
    agentRoleService,
    getPluginManager: () => pluginManagerRef,
    eventBus
  });

  return {
    provider,
    toolRegistry,
    commandRegistry,
    skillManager,
    agentRoleService,
    agentRuntime,
    visionSettings,
    visionProvider,
    setPluginManager(pluginManager: PluginManager) {
      pluginManagerRef = pluginManager;
    }
  };
}

function normalizePluginConfigs(
  configs: Record<string, { enabled?: boolean; options?: Record<string, any> }>
): Record<string, PluginConfigState> {
  return Object.fromEntries(
    Object.entries(configs).map(([name, config]) => [
      name,
      {
        enabled: config.enabled ?? false,
        options: config.options
      }
    ])
  );
}

async function createPluginRuntime(args: {
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  outboundGateway: OutboundGateway;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
}): Promise<{
  pluginManager: PluginManager;
  startBackgroundLoading: () => void;
  isBackgroundLoadingComplete: () => boolean;
}> {
  const { configStore, configManager, outboundGateway, workspace, tempDir, toolRegistry } = args;
  let started = false;
  let completed = false;

  const pluginManager = new PluginManager({
    getConfig: () => configStore.getConfig(),
    workspace,
    tempDir,
    toolRegistry,
    publishOutbound: async (message) => {
      await outboundGateway.send(message);
    },
    logger
  });

  const config = configStore.getConfig();
  pluginManager.setPluginConfigs(normalizePluginConfigs(config.plugins as Record<string, { enabled?: boolean; options?: Record<string, any> }>));

  const startBackgroundLoading = () => {
    if (started) {
      return;
    }
    started = true;

    void (async () => {
      const startedAt = Date.now();
      try {
        const newPluginConfigs = await pluginManager.applyDefaultConfigs();
        if (Object.keys(newPluginConfigs).length > 0) {
          const nextConfig = await configManager.update((draft) => {
            draft.plugins = newPluginConfigs as typeof draft.plugins;
          });
          configStore.setConfig(nextConfig);
          pluginManager.setPluginConfigs(normalizePluginConfigs(nextConfig.plugins));
          appLog.info('已应用默认插件配置');
        }

        const latestConfig = configStore.getConfig();
        if (Object.keys(latestConfig.plugins).length > 0) {
          await pluginManager.loadFromConfig(normalizePluginConfigs(latestConfig.plugins));
        }

        appLog.info('插件已在后台加载完成', {
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        appLog.error('后台加载插件失败', {
          error: normalizeBootstrapError(error)
        });
      } finally {
        completed = true;
      }
    })();
  };

  return {
    pluginManager,
    startBackgroundLoading,
    isBackgroundLoadingComplete: () => completed
  };
}

async function createChannelManager(
  config: Config,
  sessionManager: SessionManager,
  workspace: string,
  agentRuntime: AgentRuntime
): Promise<ChannelManager> {
  const channelManager = new ChannelManager(sessionManager.getDatabase(), workspace);
  channelManager.setInboundHandler(async (message) => {
    await agentRuntime.handleInbound(message);
  });
  await loadExternalChannelPlugins(channelManager, process.cwd());

  for (const [channelName, channelConfig] of Object.entries(config.channels as Record<string, { enabled?: boolean }>)) {
    if (!channelConfig?.enabled) {
      continue;
    }

    const channel = channelManager.createChannel(channelName, channelConfig);
    if (!channel) {
      appLog.warn(`未找到渠道插件: ${channelName}`);
    }
  }

  return channelManager;
}

async function createInfrastructure(args: {
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  outboundGateway: OutboundGateway;
  agentRuntime: AgentRuntime;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
}): Promise<{
  pluginManager: PluginManager;
  startPluginLoading: () => void;
  isPluginLoadingComplete: () => boolean;
  channelManager: ChannelManager;
  mcpManager: MCPClientManager | null;
}> {
  const { configStore, configManager, outboundGateway, agentRuntime, workspace, tempDir, toolRegistry, sessionManager } = args;
  const config = configStore.getConfig();
  const [pluginRuntime, channelManager] = await Promise.all([
    createPluginRuntime({
      configStore,
      configManager,
      outboundGateway,
      workspace,
      tempDir,
      toolRegistry
    }),
    createChannelManager(config, sessionManager, workspace, agentRuntime)
  ]);
  let mcpManager: MCPClientManager | undefined;
  mcpManager = startConfiguredMcpServers({
    getMcpManager: () => mcpManager,
    setMcpManager: (manager) => {
      mcpManager = manager;
    },
    toolRegistry
  }, config) ?? undefined;
  outboundGateway.setDispatcher(async (message) => {
    await channelManager.dispatch(message);
  });

  return {
    pluginManager: pluginRuntime.pluginManager,
    startPluginLoading: pluginRuntime.startBackgroundLoading,
    isPluginLoadingComplete: pluginRuntime.isBackgroundLoadingComplete,
    channelManager,
    mcpManager: mcpManager ?? null
  };
}

export async function createServices(options: ServiceFactoryOptions): Promise<Services> {
  const { workspace, tempDir, port, onCronJob, configManager, eventBus } = options;
  const startedAt = Date.now();
  const configStore = new RuntimeConfigStore(bootstrapRuntimeConfig(options.config));
  const config = configStore.getConfig();
  const log = appLog;

  log.info('正在初始化服务');
  const outboundGateway = new OutboundGateway();

  const persistenceStartedAt = Date.now();
  const {
    sessionManager,
    longTermMemoryStore,
    memoryService,
    sessionRouting
  } = await createPersistenceServices(config);
  const persistenceMs = Date.now() - persistenceStartedAt;
  log.info('服务阶段完成', {
    phase: 'persistence',
    durationMs: persistenceMs
  });

  const executionRuntimeStartedAt = Date.now();
  const executionRuntime = await createExecutionRuntime({
    getConfig: () => configStore.getConfig(),
    setConfig: (nextConfig) => { configStore.setConfig(nextConfig); },
    updateConfig: (mutator) => configManager.update(mutator),
    eventBus,
    outboundGateway,
    workspace,
    sessionManager,
    sessionRouting,
    memoryService
  });
  const executionRuntimeMs = Date.now() - executionRuntimeStartedAt;
  log.info('服务阶段完成', {
    phase: 'executionRuntime',
    durationMs: executionRuntimeMs
  });

  const { provider, toolRegistry, commandRegistry, skillManager, agentRoleService, agentRuntime, setPluginManager } = executionRuntime;

  const builtInCommands = new BuiltInCommands(sessionManager, sessionRouting, agentRoleService, agentRuntime);
  commandRegistry.registerHandler(builtInCommands);
  log.info('命令注册表已初始化');

  const cronStartedAt = Date.now();
  const cronService = new CronService(
    join(process.cwd(), '.aesyclaw', 'cron-jobs.json'),
    onCronJob || (async () => {})
  );
  await cronService.start();
  const cronMs = Date.now() - cronStartedAt;
  log.info('服务阶段完成', {
    phase: 'cron',
    durationMs: cronMs
  });

  const infrastructureStartedAt = Date.now();
  const {
    pluginManager,
    startPluginLoading,
    isPluginLoadingComplete,
    channelManager,
    mcpManager
  } = await createInfrastructure({
    configStore,
    configManager,
    outboundGateway,
    agentRuntime,
    workspace,
    tempDir,
    toolRegistry,
    sessionManager
  });
  const infrastructureMs = Date.now() - infrastructureStartedAt;
  log.info('服务阶段完成', {
    phase: 'infrastructure',
    durationMs: infrastructureMs
  });

  setPluginManager(pluginManager);
  agentRoleService.setPluginLoadingStateResolver(isPluginLoadingComplete);

  registerBuiltInTools({
    toolRegistry,
    skillManager,
    cronService,
    pluginManager,
    mcpManager,
    runSubAgentTasks: (tasks, context) => agentRuntime.runSubAgentTasks(tasks, context),
    agentRoleService,
    sessionManager,
    memoryService
  });

  const apiStartedAt = Date.now();
  const apiServer = config.server.apiEnabled === false
    ? undefined
    : new APIServer({
        port,
      agentRuntime,
      sessionManager,
      sessionRouting,
        channelManager,
        configStore,
        configManager,
        pluginManager,
      cronService,
        mcpManager: mcpManager ?? undefined,
        skillManager,
        toolRegistry,
        longTermMemoryStore,
        agentRoleService
      });
  if (apiServer) {
    await apiServer.start();
    log.info(`API 服务已在端口 ${port} 启动`);
  } else {
    log.info('API 服务已在配置中禁用');
  }
  const apiMs = Date.now() - apiStartedAt;
  log.info('服务阶段完成', {
    phase: 'api',
    durationMs: apiMs
  });

  log.info('所有服务初始化完成', {
    durationMs: Date.now() - startedAt,
    persistenceMs,
    executionRuntimeMs,
    cronMs,
    infrastructureMs,
    apiMs
  });

  return {
    provider,
    toolRegistry,
    sessionManager,
    longTermMemoryStore,
    sessionRouting,
    channelManager,
    pluginManager,
    startPluginLoading,
    isPluginLoadingComplete,
    agentRuntime,
    cronService,
    mcpManager,
    skillManager,
    config: configStore.getConfig(),
    configStore,
    configManager,
    eventBus,
    workspace,
    apiServer
  };
}
