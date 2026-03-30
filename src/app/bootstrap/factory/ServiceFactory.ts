import { AgentRuntime, OutboundGateway } from '../../../agent/index.js';
import type { ISessionRouting } from '../../../agent/domain/session.js';
import { WebServer } from '../../ws/WebServer.js';
import { ChannelManager } from '../../../features/channels/ChannelManager.js';
import { ConfigManager, RuntimeConfigStore } from '../../../features/config/index.js';
import { CronRuntimeService } from '../../../features/cron/index.js';
import { logging, logger, tokenUsage } from '../../../platform/observability/index.js';
import { filePaths } from '../../../platform/utils/paths.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import { SessionManager } from '../../../agent/infrastructure/session/SessionManager.js';
import { LongTermMemoryStore } from '../../../features/memory/infrastructure/LongTermMemoryStore.js';
import { SkillManager } from '../../../features/skills/index.js';
import { ToolRegistry } from '../../../platform/tools/index.js';
import { McpClientManager } from '../../../features/mcp/index.js';
import { PluginCoordinator } from '../../../features/plugins/index.js';
import type { Config } from '../../../types.js';
import type { CronJob } from '../../../features/cron/index.js';
import { createWebServer } from './createWebServer.js';
import { createExecutionRuntime } from './createExecutionRuntime.js';
import { createInfrastructureServices } from './createInfrastructureServices.js';
import { createCronRuntime } from '../../../features/cron/index.js';
import { createSessionRuntime } from '../../../features/sessions/index.js';
import { registerRuntimeBindings } from './registerRuntimeBindings.js';
import { runBootstrapPhase } from './runBootstrapPhase.js';
import { EventBus } from '../../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../../platform/events/events.js';
import { createSessionContext } from '../../assembly/createSessionContext.js';

const appLog = logger;

export interface Services {
  provider?: LLMProvider;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  sessionRouting: ISessionRouting;
  channelManager: ChannelManager;
  pluginManager: PluginCoordinator;
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
  webServer?: WebServer;
}

export interface ServiceFactoryOptions {
  workspace: string;
  tempDir: string;
  config: Config;
  configManager: ConfigManager;
  eventBus: EventBus<AesyClawEvents>;
  port: number;
  onCronJob: (job: CronJob) => Promise<void>;
}

export function bootstrapRuntimeConfig(config: Config): Config {
  logging.configure({
    level: config.observability.level,
    bufferSize: config.observability.bufferSize,
    pretty: config.observability.pretty
  });
  tokenUsage.configure({
    enabled: true,
    persistFile: filePaths.tokenUsageDb()
  });
  return config;
}

export async function createServices(options: ServiceFactoryOptions): Promise<Services> {
  const { workspace, tempDir, port, onCronJob, configManager, eventBus } = options;
  const initialConfig = bootstrapRuntimeConfig(options.config);
  configManager.setConfig(initialConfig);
  const configStore = new RuntimeConfigStore(configManager.getSnapshotStore());
  const config = configStore.getConfig();
  const bootstrapLog = appLog.child('Bootstrap');
  const outboundGateway = new OutboundGateway();

  const { result: sessionContext } = await runBootstrapPhase({
    phase: '会话存储初始化',
    log: bootstrapLog,
    task: () => createSessionContext(config)
  });
  const {
    db,
    sessionManager,
    longTermMemoryStore,
    sessionRouting
  } = sessionContext;

  const { result: sessionRuntime } = await runBootstrapPhase({
    phase: '会话运行时初始化',
    log: bootstrapLog,
    task: () => createSessionRuntime(sessionContext, config)
  });
  const { memoryService } = sessionRuntime;

  const { result: executionRuntime } = await runBootstrapPhase({
    phase: '执行运行时初始化',
    log: bootstrapLog,
    task: () => createExecutionRuntime({
      getConfig: () => configStore.getConfig(),
      updateConfig: (mutator) => configManager.update(mutator),
      outboundGateway,
      workspace,
      sessionManager,
      sessionRouting,
      memoryService
    })
  });

  const { provider, toolRegistry, commandRegistry, skillManager, agentRoleService, agentRuntime, setPluginManager } = executionRuntime;

  const { result: cronService } = await runBootstrapPhase({
    phase: '定时任务运行时初始化',
    log: bootstrapLog,
    task: () => createCronRuntime(onCronJob)
  });

  const { result: infrastructure } = await runBootstrapPhase({
    phase: '基础设施服务初始化',
    log: bootstrapLog,
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
    getConfig: () => configStore.getConfig(),
    updateConfig: (mutator) => configManager.update(mutator),
    setPluginManager,
    pluginManager,
    isPluginLoadingComplete,
    toolRegistry,
    skillManager,
    cronService,
    mcpManager,
    memoryService
  });

  await runBootstrapPhase({
    phase: '定时任务启动',
    log: bootstrapLog,
    task: async () => {
      await cronService.start();
    }
  });

  const { result: webServer } = await runBootstrapPhase({
    phase: 'WebSocket 服务初始化',
    log: bootstrapLog,
    task: () => createWebServer({
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
      agentRoleService,
      eventBus
    })
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
    webServer
  };
}
