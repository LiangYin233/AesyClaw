import type { RuntimeCoordinator, ISessionRouting, SessionManager } from '../../agent/index.js';
import type { AgentRoleService } from '../../features/agents/infrastructure/AgentRoleService.js';
import type { ChannelManager } from '../../features/extension/channel/ChannelManager.js';
import type { ConfigManager, RuntimeConfigStore } from '../../features/config/index.js';
import type { LongTermMemoryStore } from '../../features/memory/infrastructure/LongTermMemoryStore.js';
import type { PluginCoordinator } from '../../features/extension/plugin/index.js';
import type { CronRuntimeService } from '../../features/cron/index.js';
import type { McpClientManager } from '../../features/mcp/index.js';
import type { SkillManager } from '../../features/skills/application/SkillManager.js';
import { WebSocketApiServer } from './WebSocketApiServer.js';
import { sanitizePublicConfig } from '../../features/config/contracts/publicConfig.js';
import { parseLoggingEntriesQuery } from '../../features/observability/contracts/observability.dto.js';
import { AgentsService } from '../../features/agents/application/AgentsService.js';
import { AgentRepository } from '../../features/agents/infrastructure/AgentRepository.js';
import { AgentWorkersService } from '../../features/agents/application/AgentWorkersService.js';
import { SessionService } from '../../features/sessions/application/SessionService.js';
import { SessionsRepository } from '../../features/sessions/infrastructure/SessionsRepository.js';
import { ConversationAgentGateway } from '../../features/sessions/infrastructure/ConversationAgentGateway.js';
import { MemoryService } from '../../features/memory/application/MemoryService.js';
import { MemoryRepository } from '../../features/memory/infrastructure/MemoryRepository.js';
import { ObservabilityService } from '../../features/observability/application/ObservabilityService.js';
import { PluginAdminService } from '../../features/extension/plugin/index.js';
import { CronService } from '../../features/cron/application/CronService.js';
import { CronRepository } from '../../features/cron/infrastructure/CronRepository.js';
import { McpService } from '../../features/mcp/application/McpService.js';
import { McpRepository } from '../../features/mcp/infrastructure/McpRepository.js';
import { SkillsService } from '../../features/skills/application/SkillsService.js';
import { SystemService } from '../../features/system/application/SystemService.js';
import { DomainValidationError, ResourceNotFoundError } from '../../platform/errors/domain.js';

type WorkerCapableAgentRuntime = Pick<RuntimeCoordinator, 'handleDirect' | 'isRunning' | 'abortSession' | 'getWorkerRuntimeSnapshot' | 'onWorkerRuntimeChange'>;

export interface RegisterSubscriptionsContext {
  server: WebSocketApiServer;
  packageVersion: string;
  agentRuntime: WorkerCapableAgentRuntime;
  db: any;
  sessionManager: SessionManager;
  sessionRouting: ISessionRouting;
  agentRoleService?: AgentRoleService;
  channelManager: ChannelManager;
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  toolRegistry?: any;
  longTermMemoryStore: LongTermMemoryStore;
  pluginManager?: PluginCoordinator;
  cronService?: CronRuntimeService;
  getMcpManager: () => McpClientManager | undefined;
  setMcpManager: (manager: McpClientManager | undefined) => void;
  skillManager?: SkillManager;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(params: unknown, field: string): string {
  const value = String((asRecord(params)[field] as string) || '').trim();
  if (!value) throw new DomainValidationError(`${field} is required`, field);
  return value;
}

function requireService<T>(service: T | undefined, name: string): T {
  if (!service) throw new Error(`${name} is unavailable`);
  return service;
}

function nullOnNotFound<T>(fn: () => T): T | null {
  try { return fn(); }
  catch (e) { if (e instanceof ResourceNotFoundError) return null; throw e; }
}

const getSessionDetailSnapshot = (sessionService: SessionService, key: string) =>
  nullOnNotFound(() => sessionService.getSessionDetails(key));
const getSkillDetailSnapshot = (skillsService: SkillsService, name: string) =>
  nullOnNotFound(() => skillsService.getSkill(name));
const getMcpDetailSnapshot = (mcpService: McpService, name: string) =>
  nullOnNotFound(() => mcpService.getServer(name));

export function registerSubscriptions(context: RegisterSubscriptionsContext): void {
  const {
    server,
    packageVersion,
    agentRuntime,
    db,
    sessionManager,
    sessionRouting,
    agentRoleService,
    channelManager,
    configStore,
    configManager,
    toolRegistry,
    longTermMemoryStore,
    pluginManager,
    cronService,
    getMcpManager,
    setMcpManager,
    skillManager
  } = context;

  const getConfig = () => configStore.getConfig();

  const systemService = new SystemService(packageVersion, agentRuntime, sessionManager, channelManager, toolRegistry);
  const agentsService = new AgentsService(new AgentRepository(sessionRouting, agentRoleService));
  const agentWorkersService = new AgentWorkersService({
    getSnapshot: () => agentRuntime.getWorkerRuntimeSnapshot(),
    abortSession: (sessionKey) => agentRuntime.abortSession(sessionKey)
  });
  const sessionService = new SessionService(
    new SessionsRepository(sessionManager),
    new ConversationAgentGateway(sessionRouting, agentRoleService),
    sessionRouting,
    () => agentRoleService
  );
  const memoryService = new MemoryService(new MemoryRepository(sessionManager, longTermMemoryStore, db));
  const observabilityService = new ObservabilityService(configManager.update.bind(configManager));
  const pluginsService = pluginManager ? new PluginAdminService(pluginManager, configManager.update.bind(configManager)) : undefined;
  const cronApiService = cronService ? new CronService(new CronRepository(cronService)) : undefined;
  const mcpService = new McpService(new McpRepository({ toolRegistry, getConfig, updateConfig: configManager.update.bind(configManager), getMcpManager, setMcpManager }));
  const skillsService = skillManager ? new SkillsService(skillManager) : undefined;

  server.registerSubscription('system.status', { getSnapshot: () => systemService.getStatus() });
  server.registerSubscription('system.tools', { getSnapshot: () => systemService.getTools() });
  server.registerSubscription('agents.list', { getSnapshot: () => agentsService.listAgents() });
  server.registerSubscription('config.state', { getSnapshot: () => sanitizePublicConfig(getConfig()) });
  server.registerSubscription('skills.list', { getSnapshot: () => requireService(skillsService, 'Skill manager').listSkills() });
  server.registerSubscription('skills.detail', {
    getSnapshot: async (params) => {
      const name = String(asRecord(params).name || '').trim();
      if (!name) throw new DomainValidationError('name is required', 'name');
      return getSkillDetailSnapshot(requireService(skillsService, 'Skill manager'), name);
    }
  });
  server.registerSubscription('plugins.list', {
    getSnapshot: async () => {
      const { plugins } = await requireService(pluginsService, 'Plugins service').listPlugins();
      const channelStatuses = context.channelManager.getStatus();
      const configChannels = context.configManager.getConfig().channels || {};
      
      const channelPlugins = channelStatuses.map(status => {
        const config = configChannels[status.name] || {};
        return {
          name: status.name,
          version: '1.0.0',
          description: `Channel adapter: ${status.name}`,
          author: 'aesyclaw_official',
          enabled: status.enabled,
          settings: config,
          defaultSettings: {},
          defaultEnabled: true,
          toolCount: 0,
          kind: 'channel' as const,
          channelName: status.name,
          running: status.connected
        };
      });
      
      return { plugins: [...plugins, ...channelPlugins] };
    }
  });
  server.registerSubscription('cron.list', { getSnapshot: async () => requireService(cronApiService, 'Cron service').listJobs() });
  server.registerSubscription('mcp.list', { getSnapshot: () => mcpService.listServers() });
  server.registerSubscription('mcp.detail', {
    getSnapshot: async (params) => {
      const name = String(asRecord(params).name || '').trim();
      if (!name) throw new DomainValidationError('name is required', 'name');
      return getMcpDetailSnapshot(mcpService, name);
    }
  });
  server.registerSubscription('memory.list', { getSnapshot: async () => memoryService.listMemory() });
  server.registerSubscription('observability.logs', {
    getSnapshot: (params) => {
      const payload = asRecord(params);
      return observabilityService.getLoggingEntries(parseLoggingEntriesQuery({ limit: payload.limit, level: payload.level }));
    }
  });
  server.registerSubscription('observability.usage', { getSnapshot: () => observabilityService.getUsage() });
  server.registerSubscription('agents.workerRuntime', { getSnapshot: () => agentWorkersService.getSnapshot() });
  server.registerSubscription('sessions.list', { getSnapshot: async () => ({ sessions: await sessionService.listSessions() }) });
  server.registerSubscription('sessions.detail', { getSnapshot: (params) => getSessionDetailSnapshot(sessionService, requiredString(params, 'key')) });
}
