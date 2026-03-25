import { join } from 'path';
import { AgentRuntime, OutboundGateway } from '../../agent/index.js';
import type { SessionRoutingService } from '../../agent/infrastructure/session/SessionRoutingService.js';
import { APIServer } from '../../api/index.js';
import { ChannelManager } from '../../channels/ChannelManager.js';
import { ConfigManager, RuntimeConfigStore } from '../../config/index.js';
import { CronService } from '../../cron/index.js';
import { logging, logger, tokenUsage } from '../../observability/index.js';
import type { LLMProvider } from '../../providers/base.js';
import { LongTermMemoryStore, SessionManager } from '../../session/index.js';
import { SkillManager } from '../../skills/index.js';
import { ToolRegistry } from '../../tools/index.js';
import { MCPClientManager } from '../../mcp/index.js';
import { PluginManager } from '../../plugins/index.js';
import type { Config } from '../../types.js';
import type { CronJob } from '../../cron/index.js';
import { createApiServer } from './createApiServer.js';
import { createCronService } from './createCronService.js';
import { createExecutionRuntime } from './createExecutionRuntime.js';
import { createInfrastructureServices } from './createInfrastructureServices.js';
import { createPersistenceServices } from './createPersistenceServices.js';
import { registerRuntimeBindings } from './registerRuntimeBindings.js';
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

export async function createServices(options: ServiceFactoryOptions): Promise<Services> {
  const { workspace, tempDir, port, onCronJob, configManager, eventBus } = options;
  const startedAt = Date.now();
  const initialConfig = bootstrapRuntimeConfig(options.config);
  configManager.setConfig(initialConfig);
  const configStore = new RuntimeConfigStore(configManager.getSnapshotStore());
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
  } = await createInfrastructureServices({
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

  registerRuntimeBindings({
    commandRegistry,
    sessionManager,
    sessionRouting,
    agentRoleService,
    agentRuntime,
    setPluginManager,
    pluginManager,
    isPluginLoadingComplete,
    toolRegistry,
    skillManager,
    cronService,
    mcpManager,
    memoryService
  });

  const apiStartedAt = Date.now();
  const apiServer = await createApiServer({
    port,
    agentRuntime,
    sessionManager,
    sessionRouting,
    channelManager,
    configStore,
    configManager,
    pluginManager,
    cronService,
    mcpManager,
    skillManager,
    toolRegistry,
    longTermMemoryStore,
    agentRoleService
  });
  if (apiServer) {
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
