import { join } from 'path';
import { BuiltInCommands } from '../../agent/commands/index.js';
import { APIServer } from '../../api/index.js';
import { CronService } from '../../cron/index.js';
import { logger } from '../../observability/index.js';
import type { Config } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { CronJob } from '../../cron/index.js';
import { registerBuiltInTools } from './ToolIntegrationService.js';
import { bootstrapRuntimeConfig } from './RuntimeConfigBootstrap.js';
import { createPersistenceServices, createMemoryService } from './PersistenceFactory.js';
import { createExecutionRuntime } from './ExecutionRuntimeFactory.js';
import { createInfrastructure } from './InfrastructureFactory.js';
import { createApiServer } from './ApiInterfaceFactory.js';
import type { ToolRegistry } from '../../tools/index.js';
import type { MemoryFactStore, SessionManager } from '../../session/index.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { PluginManager } from '../../plugins/index.js';
import type { AgentRuntime } from '../../agent/runtime/AgentRuntime.js';
import { OutboundGateway } from '../../agent/runtime/AgentRuntime.js';
import type { MCPClientManager } from '../../mcp/index.js';
import type { SkillManager } from '../../skills/index.js';

const appLog = logger.child('AesyClaw');

export interface Services {
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  memoryFactStore: MemoryFactStore;
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

export { createMemoryService };

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
    memoryFactStore,
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
    sessionManager,
    cronService,
    onCronJob
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
    agentRoleService
  });

  const apiStartedAt = Date.now();
  const apiServer = await createApiServer({
    config,
    port,
    agentRuntime,
    sessionManager,
    sessionRouting,
    channelManager,
    pluginManager,
    cronService,
    mcpManager,
    skillManager,
    toolRegistry,
    memoryFactStore,
    agentRoleService
  });
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
    memoryFactStore,
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
