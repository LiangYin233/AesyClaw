import { join } from 'path';
import { EventBus } from '../../bus/EventBus.js';
import { CommandRegistry, BuiltInCommands } from '../../agent/commands/index.js';
import { APIServer } from '../../api/index.js';
import { CronService } from '../../cron/index.js';
import { logger } from '../../logger/index.js';
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
import type { ChannelManager } from '../../channels/index.js';
import type { PluginManager } from '../../plugins/index.js';
import type { AgentLoop } from '../../agent/index.js';
import type { MCPClientManager } from '../../mcp/index.js';
import type { SkillManager } from '../../skills/index.js';

const appLog = logger.child({ prefix: 'AesyClaw' });

export interface Services {
  eventBus: EventBus;
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  memoryFactStore: MemoryFactStore;
  channelManager: ChannelManager;
  pluginManager: PluginManager;
  startPluginLoading: () => void;
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

export { createMemoryService };

export async function createServices(options: ServiceFactoryOptions): Promise<Services> {
  const { workspace, tempDir, port, onCronJob } = options;
  const startedAt = Date.now();
  let config = bootstrapRuntimeConfig(options.config);
  const log = appLog;

  log.info('Initializing services...');

  const eventBus = new EventBus();

  const persistenceStartedAt = Date.now();
  const {
    sessionManager,
    memoryFactStore,
    memoryService,
    sessionRouting
  } = await createPersistenceServices(config);
  const persistenceMs = Date.now() - persistenceStartedAt;
  log.info('Service phase completed', {
    phase: 'persistence',
    durationMs: persistenceMs
  });

  const executionRuntimeStartedAt = Date.now();
  const executionRuntime = await createExecutionRuntime({
    getConfig: () => config,
    setConfig: (nextConfig) => { config = nextConfig; },
    eventBus,
    workspace,
    sessionManager,
    sessionRouting,
    memoryService
  });
  const executionRuntimeMs = Date.now() - executionRuntimeStartedAt;
  log.info('Service phase completed', {
    phase: 'executionRuntime',
    durationMs: executionRuntimeMs
  });

  const { provider, toolRegistry, skillManager, agentRoleService, agent } = executionRuntime;

  const commandRegistry = new CommandRegistry();
  const builtInCommands = new BuiltInCommands(sessionManager, sessionRouting, agentRoleService, agent);
  commandRegistry.registerHandler(builtInCommands);
  agent.setCommandRegistry(commandRegistry);
  log.info('Command registry initialized');

  const cronStartedAt = Date.now();
  const cronService = new CronService(
    join(process.cwd(), '.aesyclaw', 'cron-jobs.json'),
    onCronJob || (async () => {})
  );
  await cronService.start();
  const cronMs = Date.now() - cronStartedAt;
  log.info('Service phase completed', {
    phase: 'cron',
    durationMs: cronMs
  });

  const infrastructureStartedAt = Date.now();
  const {
    pluginManager,
    startPluginLoading,
    channelManager,
    mcpManager
  } = await createInfrastructure({
    config,
    eventBus,
    agent,
    workspace,
    tempDir,
    toolRegistry,
    sessionManager,
    cronService,
    onCronJob
  });
  const infrastructureMs = Date.now() - infrastructureStartedAt;
  log.info('Service phase completed', {
    phase: 'infrastructure',
    durationMs: infrastructureMs
  });

  agent.setPluginManager(pluginManager);

  registerBuiltInTools({
    toolRegistry,
    skillManager,
    cronService,
    eventBus,
    pluginManager,
    mcpManager,
    agent,
    agentRoleService
  });

  const apiStartedAt = Date.now();
  const apiServer = await createApiServer({
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
    memoryFactStore,
    agentRoleService
  });
  const apiMs = Date.now() - apiStartedAt;
  log.info('Service phase completed', {
    phase: 'api',
    durationMs: apiMs
  });

  log.info('All services initialized successfully', {
    durationMs: Date.now() - startedAt,
    persistenceMs,
    executionRuntimeMs,
    cronMs,
    infrastructureMs,
    apiMs
  });

  return {
    eventBus,
    provider,
    toolRegistry,
    sessionManager,
    memoryFactStore,
    channelManager,
    pluginManager,
    startPluginLoading,
    agent,
    cronService,
    mcpManager,
    skillManager,
    config,
    workspace,
    apiServer
  };
}
