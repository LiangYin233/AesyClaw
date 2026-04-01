import type { Config } from '../../types.js';
import type { RuntimeCoordinator, ISessionRouting, SessionManager } from '../../agent/index.js';
import type { AgentRoleService } from '../../features/agents/infrastructure/AgentRoleService.js';
import type { ChannelManager } from '../../features/extension/channel/ChannelManager.js';
import type { ConfigManager, RuntimeConfigStore } from '../../features/config/index.js';
import type { Database } from '../../platform/db/index.js';
import type { ToolRegistry } from '../../platform/tools/ToolRegistry.js';
import type { LongTermMemoryStore } from '../../features/memory/infrastructure/LongTermMemoryStore.js';
import type { PluginCoordinator } from '../../features/extension/plugin/index.js';
import type { CronRuntimeService } from '../../features/cron/index.js';
import type { McpClientManager } from '../../features/mcp/index.js';
import type { SkillManager } from '../../features/skills/application/SkillManager.js';
import { WebSocketApiServer } from './WebSocketApiServer.js';
import { AgentsService } from '../../features/agents/application/AgentsService.js';
import { AgentRepository } from '../../features/agents/infrastructure/AgentRepository.js';
import { AgentWorkersService } from '../../features/agents/application/AgentWorkersService.js';
import { parseAgentRoleInput } from '../../features/agents/contracts/agents.dto.js';
import { ChatService } from '../../features/chat/application/ChatService.js';
import { parseCreateChatRequest } from '../../features/chat/contracts/chat.dto.js';
import { SystemService } from '../../features/system/application/SystemService.js';
import { SessionService } from '../../features/sessions/application/SessionService.js';
import { SessionsRepository } from '../../features/sessions/infrastructure/SessionsRepository.js';
import { ConversationAgentGateway } from '../../features/sessions/infrastructure/ConversationAgentGateway.js';
import { MemoryService } from '../../features/memory/application/MemoryService.js';
import { MemoryRepository } from '../../features/memory/infrastructure/MemoryRepository.js';
import { ObservabilityService } from '../../features/observability/application/ObservabilityService.js';
import { PluginAdminService } from '../../features/extension/plugin/index.js';
import { parsePluginConfigUpdate, parseTogglePlugin } from '../../features/extension/plugin/index.js';
import { CronService } from '../../features/cron/application/CronService.js';
import { CronRepository } from '../../features/cron/infrastructure/CronRepository.js';
import { parseCreateCronJob, parseToggleCronJob, parseUpdateCronJob } from '../../features/cron/contracts/cron.dto.js';
import { McpService } from '../../features/mcp/application/McpService.js';
import { McpRepository } from '../../features/mcp/infrastructure/McpRepository.js';
import { parseCreateMcpServer, parseToggleMcpServer } from '../../features/mcp/contracts/mcp.dto.js';
import { parseLoggingEntriesQuery, parseLoggingLevelUpdate } from '../../features/observability/contracts/observability.dto.js';
import { parseToggleSkill } from '../../features/skills/contracts/skills.dto.js';
import { SkillsService } from '../../features/skills/application/SkillsService.js';
import { sanitizePublicConfig, preserveServerTokenInPublicConfig } from '../../features/config/contracts/publicConfig.js';
import { parseConfigUpdate } from '../../features/config/contracts/config.dto.js';
import { getConfigValidationIssue } from '../../features/config/index.js';
import { DomainValidationError, DependencyUnavailableError } from '../../platform/errors/domain.js';

type WorkerCapableAgentRuntime = Pick<RuntimeCoordinator, 'handleDirect' | 'isRunning' | 'abortSession' | 'getWorkerRuntimeSnapshot' | 'onWorkerRuntimeChange'>;

export interface RegisterRpcHandlersContext {
  server: WebSocketApiServer;
  packageVersion: string;
  maxMessageLength: number;
  agentRuntime: WorkerCapableAgentRuntime;
  db: Database;
  sessionManager: SessionManager;
  sessionRouting: ISessionRouting;
  agentRoleService?: AgentRoleService;
  channelManager: ChannelManager;
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  toolRegistry?: ToolRegistry;
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
  if (!service) throw new DependencyUnavailableError(`${name} is unavailable`);
  return service;
}

export function registerRpcHandlers(context: RegisterRpcHandlersContext): void {
  const {
    server,
    packageVersion,
    maxMessageLength,
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
  const updateConfig = (mutator: (config: Config) => void | Config | Promise<void | Config>) =>
    configManager.update(mutator);

  const systemService = new SystemService(packageVersion, agentRuntime, sessionManager, channelManager, toolRegistry);
  const agentsService = new AgentsService(new AgentRepository(sessionRouting, agentRoleService));
  const agentWorkersService = new AgentWorkersService({
    getSnapshot: () => agentRuntime.getWorkerRuntimeSnapshot(),
    abortSession: (sessionKey) => agentRuntime.abortSession(sessionKey)
  });
  const sessionService = new SessionService(
    new SessionsRepository(sessionManager),
    new ConversationAgentGateway(sessionRouting, agentRoleService),
    sessionRouting
  );
  const chatService = new ChatService(agentRuntime, maxMessageLength);
  const pluginsService = pluginManager ? new PluginAdminService(pluginManager, updateConfig) : undefined;
  const observabilityService = new ObservabilityService(updateConfig);
  const memoryService = new MemoryService(new MemoryRepository(sessionManager, longTermMemoryStore, db));
  const mcpService = new McpService(new McpRepository({ toolRegistry, getConfig, updateConfig, getMcpManager, setMcpManager }));
  const cronApiService = cronService ? new CronService(new CronRepository(cronService)) : undefined;
  const skillsService = skillManager ? new SkillsService(skillManager) : undefined;

  server.registerRpc('system.getStatus', () => systemService.getStatus());
  server.registerRpc('system.getTools', () => systemService.getTools());

  server.registerRpc('agents.list', () => agentsService.listAgents());
  server.registerRpc('agents.getWorkerRuntime', () => agentWorkersService.getSnapshot());
  server.registerRpc('agents.abortWorkerSession', (params) => agentWorkersService.abortSession(requiredString(params, 'sessionKey')));
  server.registerRpc('agents.create', async (params) => {
    const result = await agentsService.createAgent(parseAgentRoleInput(params));
    server.publish('agents.list');
    return result;
  });
  server.registerRpc('agents.update', async (params) => {
    const payload = asRecord(params);
    const name = requiredString(payload, 'name');
    const result = await agentsService.updateAgent(name, parseAgentRoleInput(payload, name));
    server.publish('agents.list');
    return result;
  });
  server.registerRpc('agents.delete', (params) => {
    const name = requiredString(params, 'name');
    const result = agentsService.deleteAgent(name);
    server.publish('agents.list');
    return result;
  });

  server.registerRpc('sessions.list', async () => ({ sessions: await sessionService.listSessions() }));
  server.registerRpc('sessions.getDetail', (params) => sessionService.getSessionDetails(requiredString(params, 'key')));
  server.registerRpc('sessions.delete', (params) => sessionService.deleteSession(requiredString(params, 'key')));

  server.registerRpc('chat.createResponse', async (params) => chatService.createChatResponse(parseCreateChatRequest(params)));

  server.registerRpc('channels.getStatus', () => {
    const status = channelManager.getStatus();
    const result: Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }> = {};
    for (const s of status) {
      result[s.name] = { running: s.connected, enabled: s.enabled, connected: s.connected };
    }
    return result;
  });
  server.registerRpc('channels.sendMessage', async (params) => {
    const payload = asRecord(params);
    const success = await channelManager.sendText(requiredString(payload, 'name'), requiredString(payload, 'chatId'), requiredString(payload, 'content'));
    return { success };
  });

  server.registerRpc('config.get', () => sanitizePublicConfig(getConfig()));
  server.registerRpc('config.update', async (params) => {
    try {
      const currentConfig = getConfig();
      await configManager.update(() => preserveServerTokenInPublicConfig(parseConfigUpdate(params), currentConfig) as Config);
      server.publish('config.state');
      return { success: true };
    } catch (error) {
      const issue = getConfigValidationIssue(error);
      if (issue) throw new DomainValidationError(issue.message, issue.field);
      throw error;
    }
  });

  server.registerRpc('skills.list', () => requireService(skillsService, 'Skill manager').listSkills());
  server.registerRpc('skills.get', (params) => {
    const name = String(asRecord(params).name || '').trim();
    if (!name) throw new DomainValidationError('name is required', 'name');
    return requireService(skillsService, 'Skill manager').getSkill(name);
  });
  server.registerRpc('skills.reload', async () => {
    const result = await requireService(skillsService, 'Skill manager').reload();
    server.publish('skills.list');
    server.publish('skills.detail');
    return result;
  });
  server.registerRpc('skills.toggle', async (params) => {
    const payload = asRecord(params);
    const name = String(payload.name || '').trim();
    if (!name) throw new DomainValidationError('name is required', 'name');
    const result = await requireService(skillsService, 'Skill manager').toggleSkill(name, parseToggleSkill(payload).enabled);
    server.publish('skills.list');
    server.publish('skills.detail', { match: (p) => String(asRecord(p).name || '').trim() === name });
    return result;
  });

  server.registerRpc('plugins.list', async () => requireService(pluginsService, 'Plugins service').listPlugins());
  server.registerRpc('plugins.toggle', async (params) => {
    const result = await requireService(pluginsService, 'Plugins service').togglePlugin(requiredString(params, 'name'), { enabled: parseTogglePlugin(params).enabled });
    server.publish('plugins.list');
    return result;
  });
  server.registerRpc('plugins.updateConfig', async (params) => {
    const result = await requireService(pluginsService, 'Plugins service').updatePluginConfig(requiredString(params, 'name'), { settings: parsePluginConfigUpdate(params).settings });
    server.publish('plugins.list');
    return result;
  });

  server.registerRpc('cron.list', async () => requireService(cronApiService, 'Cron service').listJobs());
  server.registerRpc('cron.get', (params) => requireService(cronApiService, 'Cron service').getJob(requiredString(params, 'id')));
  server.registerRpc('cron.create', async (params) => {
    const result = await requireService(cronApiService, 'Cron service').createJob(parseCreateCronJob(params));
    server.publish('cron.list');
    return result;
  });
  server.registerRpc('cron.update', async (params) => {
    const payload = asRecord(params);
    const result = await requireService(cronApiService, 'Cron service').updateJob(requiredString(payload, 'id'), parseUpdateCronJob(payload));
    server.publish('cron.list');
    return result;
  });
  server.registerRpc('cron.delete', (params) => {
    const result = requireService(cronApiService, 'Cron service').deleteJob(requiredString(params, 'id'));
    server.publish('cron.list');
    return result;
  });
  server.registerRpc('cron.toggle', async (params) => {
    const result = await requireService(cronApiService, 'Cron service').toggleJob(requiredString(asRecord(params), 'id'), parseToggleCronJob(params).enabled);
    server.publish('cron.list');
    return result;
  });

  server.registerRpc('mcp.list', () => mcpService.listServers());
  server.registerRpc('mcp.get', (params) => mcpService.getServer(requiredString(params, 'name')));
  server.registerRpc('mcp.create', async (params) => {
    const payload = asRecord(params);
    const name = requiredString(payload, 'name');
    const result = await mcpService.createServer(name, parseCreateMcpServer(payload.config ?? payload));
    server.publish('mcp.list');
    server.publish('mcp.detail', { match: (p) => requiredString(p, 'name') === name });
    return result;
  });
  server.registerRpc('mcp.delete', async (params) => {
    const name = requiredString(params, 'name');
    const result = await mcpService.deleteServer(name);
    server.publish('mcp.list');
    server.publish('mcp.detail', { match: (p) => requiredString(p, 'name') === name });
    return result;
  });
  server.registerRpc('mcp.reconnect', async (params) => {
    const name = requiredString(params, 'name');
    const result = await mcpService.reconnectServer(name);
    server.publish('mcp.list');
    server.publish('mcp.detail', { match: (p) => requiredString(p, 'name') === name });
    return result;
  });
  server.registerRpc('mcp.toggle', async (params) => {
    const payload = asRecord(params);
    const name = requiredString(payload, 'name');
    const result = await mcpService.toggleServer(name, parseToggleMcpServer(payload).enabled);
    server.publish('mcp.list');
    server.publish('mcp.detail', { match: (p) => requiredString(p, 'name') === name });
    return result;
  });

  server.registerRpc('memory.list', async () => memoryService.listMemory());
  server.registerRpc('memory.getHistory', (params) => memoryService.getHistory(requiredString(params, 'key')));
  server.registerRpc('memory.deleteOne', (params) => {
    const result = memoryService.deleteConversation(requiredString(params, 'key'));
    server.publish('memory.list');
    return result;
  });
  server.registerRpc('memory.deleteAll', async () => {
    const result = await memoryService.deleteAll();
    server.publish('memory.list');
    return result;
  });

  server.registerRpc('observability.getLoggingConfig', () => observabilityService.getLoggingConfig());
  server.registerRpc('observability.getLoggingEntries', (params) => {
    const payload = asRecord(params);
    return observabilityService.getLoggingEntries(parseLoggingEntriesQuery({ limit: payload.limit, level: payload.level }));
  });
  server.registerRpc('observability.setLogLevel', async (params) => observabilityService.updateLoggingLevel(parseLoggingLevelUpdate(params).level));
  server.registerRpc('observability.getUsage', () => observabilityService.getUsage());
  server.registerRpc('observability.resetUsage', () => observabilityService.resetUsage());
}
