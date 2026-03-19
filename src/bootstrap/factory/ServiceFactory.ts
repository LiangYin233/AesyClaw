import { join } from 'path';
import { BuiltInCommands } from '../../agent/commands/index.js';
import { AgentRuntime, OutboundGateway } from '../../agent/runtime/AgentRuntime.js';
import { LongTermMemoryService } from '../../agent/memory/LongTermMemoryService.js';
import { SessionMemoryService } from '../../agent/memory/SessionMemoryService.js';
import { SessionRoutingService } from '../../agent/session/SessionRoutingService.js';
import { AgentRoleService } from '../../agent/roles/AgentRoleService.js';
import { APIServer } from '../../api/index.js';
import { ChannelManager } from '../../channels/ChannelManager.js';
import { loadExternalChannelPlugins } from '../../channels/ChannelPluginLoader.js';
import { ConfigLoader } from '../../config/loader.js';
import { getMainAgentRole, parseConfig, resolveProviderSelection } from '../../config/index.js';
import { CronService } from '../../cron/index.js';
import { logging, logger, tokenUsage } from '../../observability/index.js';
import { createProvider } from '../../providers/index.js';
import type { LLMProvider } from '../../providers/base.js';
import { LongTermMemoryStore, SessionManager } from '../../session/index.js';
import { SkillManager } from '../../skills/index.js';
import { ToolRegistry, registerBuiltInTools, registerMcpTools } from '../../tools/index.js';
import { CommandRegistry } from '../../agent/commands/index.js';
import { MCPClientManager } from '../../mcp/index.js';
import { PluginManager } from '../../plugins/index.js';
import type { PluginConfigState } from '../../plugins/index.js';
import type { Config, VisionSettings } from '../../types.js';
import type { CronJob } from '../../cron/index.js';
import { normalizeError } from '../../errors/index.js';

const appLog = logger.child('AesyClaw');

export interface Services {
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  channelManager: ChannelManager;
  pluginManager: PluginManager;
  startPluginLoading: () => void;
  isPluginLoadingComplete: () => boolean;
  agentRuntime: AgentRuntime;
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

function createOptionalProvider(resolved: ReturnType<typeof resolveProviderSelection>, label: string) {
  if (!resolved.providerConfig) {
    appLog.warn(`配置中未找到${label}提供商 "${resolved.name}"`);
    return undefined;
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

export function createMemoryService(
  config: Config,
  sessionManager: SessionManager,
  longTermMemoryStore: LongTermMemoryStore
): SessionMemoryService | undefined {
  const summaryConfig = config.agent.defaults.memorySummary;
  const memoryConfig = config.agent.defaults.memoryFacts;
  const summaryEnabled = summaryConfig.enabled && !!summaryConfig.provider && !!summaryConfig.model;

  if (!summaryConfig.enabled && !memoryConfig.enabled) {
    return undefined;
  }

  if (summaryConfig.enabled && !summaryEnabled) {
    appLog.warn('会话摘要已启用，但未完整配置 memorySummary.provider/model；摘要压缩将被跳过');
  }

  const summaryRuntimeConfig = {
    enabled: summaryEnabled,
    model: summaryConfig.model || undefined,
    compressRounds: summaryConfig.compressRounds,
    memoryWindow: config.agent.defaults.memoryWindow,
    contextMode: config.agent.defaults.contextMode
  };
  if (memoryConfig.enabled && (!memoryConfig.provider || !memoryConfig.model)) {
    appLog.warn('长期记忆已启用，但未完整配置 memoryFacts.provider/model；后台自治维护将被跳过');
  }
  const longTermMemoryService = memoryConfig.enabled
    ? new LongTermMemoryService(
        sessionManager,
        longTermMemoryStore,
        {
          enabled: memoryConfig.enabled,
          model: memoryConfig.model || undefined
        },
        memoryConfig.provider && memoryConfig.model
          ? createOptionalProvider(resolveProviderSelection(config, memoryConfig.provider, memoryConfig.model), '长期记忆')
          : undefined
      )
    : undefined;

  return new SessionMemoryService(
    sessionManager,
    summaryEnabled
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
  const sessionManager = new SessionManager(
    join(process.cwd(), '.aesyclaw', 'sessions'),
    config.agent.defaults.maxSessions
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
    sessionRouting: new SessionRoutingService(sessionManager, config.agent.defaults.contextMode)
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

function buildVisionSettingsFromRole(config: ReturnType<typeof getMainAgentRole>): VisionSettings {
  return {
    enabled: config.vision,
    reasoning: config.reasoning,
    visionProviderName: config.visionProvider || undefined,
    visionModelName: config.visionModel || undefined
  };
}

async function createSkillManager(config: Config, workspace: string): Promise<SkillManager> {
  const skillManager = new SkillManager({
    builtinSkillsDir: './skills',
    externalSkillsDir: join(workspace, 'skills')
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
  const { getConfig, setConfig, outboundGateway, workspace, sessionManager, sessionRouting, memoryService } = args;
  const config = getConfig();
  const toolRegistry = new ToolRegistry({
    defaultTimeout: config.tools.timeoutMs
  });
  const commandRegistry = new CommandRegistry();
  const mainRole = getMainAgentRole(config);
  const provider = createRequiredProvider(config, mainRole.provider, mainRole.model);
  const visionSettings = buildVisionSettingsFromRole(mainRole);
  const visionProvider = createVisionProvider(config, visionSettings);
  const skillManager = await createSkillManager(config, workspace);
  const agentRoleService = new AgentRoleService(
    getConfig,
    setConfig,
    toolRegistry,
    skillManager
  );

  let pluginManagerRef: PluginManager | undefined;
  const agentRuntime = new AgentRuntime({
    provider,
    toolRegistry,
    sessionManager,
    commandRegistry,
    sessionRouting,
    outboundGateway,
    workspace,
    systemPrompt: mainRole.systemPrompt,
    maxIterations: config.agent.defaults.maxToolIterations,
    model: mainRole.model,
    memoryWindow: config.agent.defaults.memoryWindow,
    visionSettings,
    visionProvider,
    memoryService,
    agentRoleService,
    getPluginManager: () => pluginManagerRef
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
  config: Config;
  outboundGateway: OutboundGateway;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
}): Promise<{
  pluginManager: PluginManager;
  startBackgroundLoading: () => void;
  isBackgroundLoadingComplete: () => boolean;
}> {
  const { config, outboundGateway, workspace, tempDir, toolRegistry } = args;
  let started = false;
  let completed = false;

  const pluginManager = new PluginManager({
    getConfig: () => ConfigLoader.get(),
    workspace,
    tempDir,
    toolRegistry,
    publishOutbound: async (message) => {
      await outboundGateway.send(message);
    },
    logger
  });

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
          const nextConfig = await ConfigLoader.update((draft) => {
            draft.plugins = newPluginConfigs as typeof draft.plugins;
          });
          config.plugins = nextConfig.plugins;
          pluginManager.setPluginConfigs(normalizePluginConfigs(nextConfig.plugins));
          appLog.info('已应用默认插件配置');
        }

        if (Object.keys(config.plugins).length > 0) {
          await pluginManager.loadFromConfig(normalizePluginConfigs(config.plugins));
        }

        appLog.info('插件已在后台加载完成', {
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        appLog.error('后台加载插件失败', {
          error: normalizeError(error)
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

function createMcpManager(config: Config, toolRegistry: ToolRegistry): MCPClientManager | null {
  if (!config.mcp || Object.keys(config.mcp).length === 0) {
    return null;
  }

  const mcpManager = new MCPClientManager();
  registerMcpTools(toolRegistry, mcpManager);
  mcpManager.connectAsync(config.mcp);
  appLog.info('MCP 服务器正在后台连接');
  return mcpManager;
}

async function createInfrastructure(args: {
  config: Config;
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
  const { config, outboundGateway, agentRuntime, workspace, tempDir, toolRegistry, sessionManager } = args;
  const [pluginRuntime, channelManager] = await Promise.all([
    createPluginRuntime({
      config,
      outboundGateway,
      workspace,
      tempDir,
      toolRegistry
    }),
    createChannelManager(config, sessionManager, workspace, agentRuntime)
  ]);
  const mcpManager = createMcpManager(config, toolRegistry);
  outboundGateway.setDispatcher(async (message) => {
    await channelManager.dispatch(message);
  });

  return {
    pluginManager: pluginRuntime.pluginManager,
    startPluginLoading: pluginRuntime.startBackgroundLoading,
    isPluginLoadingComplete: pluginRuntime.isBackgroundLoadingComplete,
    channelManager,
    mcpManager
  };
}

export async function createServices(options: ServiceFactoryOptions): Promise<Services> {
  const { workspace, tempDir, port, onCronJob } = options;
  const startedAt = Date.now();
  let config = bootstrapRuntimeConfig(options.config);
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
    getConfig: () => config,
    setConfig: (nextConfig) => { config = nextConfig; },
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
    config,
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
    agentRuntime,
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
        config,
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
    channelManager,
    pluginManager,
    startPluginLoading,
    isPluginLoadingComplete,
    agentRuntime,
    cronService,
    mcpManager,
    skillManager,
    config,
    workspace,
    apiServer
  };
}
