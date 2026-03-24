import { join } from 'path';
import { BuiltInCommands } from '../../agent/application/index.js';
import { AgentRuntime, OutboundGateway } from '../../agent/index.js';
import type { SessionRoutingService } from '../../agent/infrastructure/session/SessionRoutingService.js';
import { APIServer } from '../../api/index.js';
import { ChannelManager } from '../../channels/ChannelManager.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { RuntimeConfigStore } from '../../config/RuntimeConfigStore.js';
import { CronService } from '../../cron/index.js';
import { logging, logger, tokenUsage } from '../../observability/index.js';
import type { LLMProvider } from '../../providers/base.js';
import { LongTermMemoryStore, SessionManager } from '../../session/index.js';
import { SkillManager } from '../../skills/index.js';
import { ToolRegistry, registerBuiltInTools } from '../../tools/index.js';
import { MCPClientManager } from '../../mcp/index.js';
import { startConfiguredMcpServers } from '../../mcp/runtime.js';
import { PluginManager } from '../../plugins/index.js';
import type { Config } from '../../types.js';
import type { CronJob } from '../../cron/index.js';
import { createChannelServices } from './createChannelServices.js';
import { createCronService } from './createCronService.js';
import { createExecutionRuntime } from './createExecutionRuntime.js';
import { createPersistenceServices } from './createPersistenceServices.js';
import { createPluginServices } from './createPluginServices.js';
import { EventBus } from '../../events/EventBus.js';
import type { AesyClawEvents } from '../../events/events.js';

const appLog = logger.child('AesyClaw');

export interface Services {
  provider?: LLMProvider;
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

export function bootstrapRuntimeConfig(config: Config): Config {
  logging.configure({
    level: config.observability.level
  });
  tokenUsage.configure({
    enabled: true,
    persistFile: join(process.cwd(), '.aesyclaw', 'token-usage.db')
  });
  return config;
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
    createPluginServices({
      configStore,
      configManager,
      outboundGateway,
      workspace,
      tempDir,
      toolRegistry
    }),
    createChannelServices({
      configStore,
      configManager,
      sessionManager,
      workspace,
      agentRuntime
    })
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
  const cronService = await createCronService(onCronJob);
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
    runTemporarySubAgentTask: (baseAgentName, task, systemPrompt, context) =>
      agentRuntime.runTemporarySubAgentTask(baseAgentName, task, systemPrompt, context),
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
