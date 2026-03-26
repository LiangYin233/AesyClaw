import { join } from 'path';
import { AgentRuntime, OutboundGateway } from '../../../agent/index.js';
import type { SessionRoutingService } from '../../../agent/infrastructure/session/SessionRoutingService.js';
import { APIServer } from '../../api/index.js';
import { ChannelManager } from '../../../features/channels/application/ChannelManager.js';
import { ConfigManager, RuntimeConfigStore } from '../../../features/config/index.js';
import { CronRuntimeService } from '../../../features/cron/index.js';
import { logging, logger, tokenUsage } from '../../../platform/observability/index.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import { LongTermMemoryStore, SessionManager } from '../../../features/sessions/index.js';
import { SkillManager } from '../../../features/skills/index.js';
import { ToolRegistry } from '../../../platform/tools/index.js';
import { McpClientManager } from '../../../features/mcp/index.js';
import { PluginManager } from '../../../features/plugins/index.js';
import type { Config } from '../../../types.js';
import type { CronJob } from '../../../features/cron/index.js';
import { createApiServer } from './createApiServer.js';
import { createExecutionRuntime } from './createExecutionRuntime.js';
import { createInfrastructureServices } from './createInfrastructureServices.js';
import { createCronRuntime } from '../../../features/cron/index.js';
import { createSessionRuntime } from '../../../features/sessions/index.js';
import { registerRuntimeBindings } from './registerRuntimeBindings.js';
import { runBootstrapPhase } from './runBootstrapPhase.js';
import { EventBus } from '../../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../../platform/events/events.js';

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
  cronService: CronRuntimeService;
  mcpManager: McpClientManager | null;
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
    level: config.observability.level,
    bufferSize: config.observability.bufferSize,
    pretty: config.observability.pretty
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

  const { result: persistence, durationMs: persistenceMs } = await runBootstrapPhase({
    phase: 'persistence',
    log,
    task: () => createSessionRuntime(config)
  });
  const {
    db,
    sessionManager,
    longTermMemoryStore,
    memoryService,
    sessionRouting
  } = persistence;

  const { result: executionRuntime, durationMs: executionRuntimeMs } = await runBootstrapPhase({
    phase: 'executionRuntime',
    log,
    task: () => createExecutionRuntime({
      getConfig: () => configStore.getConfig(),
      updateConfig: (mutator) => configManager.update(mutator),
      eventBus,
      outboundGateway,
      workspace,
      sessionManager,
      sessionRouting,
      memoryService
    })
  });

  const { provider, toolRegistry, commandRegistry, skillManager, agentRoleService, agentRuntime, setPluginManager } = executionRuntime;

  const { result: cronService, durationMs: cronMs } = await runBootstrapPhase({
    phase: 'cron',
    log,
    task: () => createCronRuntime(onCronJob)
  });

  const { result: infrastructure, durationMs: infrastructureMs } = await runBootstrapPhase({
    phase: 'infrastructure',
    log,
    task: () => createInfrastructureServices({
      configStore,
      configManager,
      outboundGateway,
      agentRuntime,
      workspace,
      tempDir,
      toolRegistry,
      db
    })
  });
  const {
    pluginManager,
    startPluginLoading,
    isPluginLoadingComplete,
    channelManager,
    mcpManager
  } = infrastructure;

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

  const { durationMs: cronStartMs } = await runBootstrapPhase({
    phase: 'cron.start',
    log,
    task: async () => {
      await cronService.start();
    }
  });

  const { result: apiServer, durationMs: apiMs } = await runBootstrapPhase({
    phase: 'api',
    log,
    task: () => createApiServer({
      port,
      agentRuntime,
      db,
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
    })
  });
  if (apiServer) {
    log.info(`API 服务已在端口 ${port} 启动`);
  } else {
    log.info('API 服务已在配置中禁用');
  }

  log.info('所有服务初始化完成', {
    durationMs: Date.now() - startedAt,
    persistenceMs,
    executionRuntimeMs,
    cronMs,
    cronStartMs,
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
