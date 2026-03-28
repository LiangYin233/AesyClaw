import type { Config } from '../types.js';
import type { AgentRuntime } from '../agent/index.js';
import type { AgentRoleService } from '../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../agent/infrastructure/session/SessionRoutingService.js';
import type { ChannelManager } from './channels/application/ChannelManager.js';
import type { ConfigManager, RuntimeConfigStore } from './config/index.js';
import type { Database } from '../platform/db/index.js';
import type { ToolRegistry } from '../platform/tools/ToolRegistry.js';
import type { SessionManager } from './sessions/application/SessionManager.js';
import type { LongTermMemoryStore } from './sessions/infrastructure/LongTermMemoryStore.js';
import type { PluginManager } from './plugins/index.js';
import type { CronRuntimeService } from './cron/index.js';
import type { McpClientManager } from './mcp/index.js';
import type { SkillManager } from './skills/application/SkillManager.js';
import type { EventBus } from '../platform/events/EventBus.js';
import type { AesyClawEvents } from '../platform/events/events.js';
import { WebSocketApiServer } from '../app/ws/WebSocketApiServer.js';
import { AgentRepository } from './agents/infrastructure/AgentRepository.js';
import { AgentsService } from './agents/application/AgentsService.js';
import { AgentWorkersService } from './agents/application/AgentWorkersService.js';
import { parseAgentRoleInput } from './agents/contracts/agents.dto.js';
import { ChannelsService } from './channels/application/ChannelsService.js';
import { ChannelRepository } from './channels/infrastructure/ChannelRepository.js';
import { parseSendChannelMessage } from './channels/contracts/channels.dto.js';
import { ChatService } from './chat/application/ChatService.js';
import { parseCreateChatRequest } from './chat/contracts/chat.dto.js';
import { getConfigValidationIssue } from './config/index.js';
import { sanitizePublicConfig, preserveServerTokenInPublicConfig } from './config/contracts/publicConfig.js';
import { parseConfigUpdate } from './config/contracts/config.dto.js';
import { CronService } from './cron/application/CronService.js';
import { CronRepository } from './cron/infrastructure/CronRepository.js';
import { parseCreateCronJob, parseToggleCronJob, parseUpdateCronJob } from './cron/contracts/cron.dto.js';
import { McpService } from './mcp/application/McpService.js';
import { McpRepository } from './mcp/infrastructure/McpRepository.js';
import { parseCreateMcpServer, parseToggleMcpServer } from './mcp/contracts/mcp.dto.js';
import { MemoryService } from './memory/application/MemoryService.js';
import { MemoryRepository } from './memory/infrastructure/MemoryRepository.js';
import { ObservabilityService } from './observability/application/ObservabilityService.js';
import { parseLoggingEntriesQuery, parseLoggingLevelUpdate } from './observability/contracts/observability.dto.js';
import { PluginRepository } from './plugins/infrastructure/PluginRepository.js';
import { PluginsService } from './plugins/application/PluginsService.js';
import { parsePluginConfigUpdate, parseTogglePlugin } from './plugins/contracts/plugins.dto.js';
import { SessionService } from './sessions/application/SessionService.js';
import { ConversationAgentGateway } from './sessions/infrastructure/ConversationAgentGateway.js';
import { SessionsRepository } from './sessions/infrastructure/SessionsRepository.js';
import { SkillsService } from './skills/application/SkillsService.js';
import { parseToggleSkill } from './skills/contracts/skills.dto.js';
import { SystemService } from './system/application/SystemService.js';
import { DependencyUnavailableError, DomainValidationError, ResourceNotFoundError } from '../platform/errors/domain.js';
import { logging, tokenUsage } from '../platform/observability/index.js';

type WorkerCapableAgentRuntime = Pick<
  AgentRuntime,
  'handleDirect' | 'isRunning' | 'abortSession' | 'getWorkerRuntimeSnapshot' | 'onWorkerRuntimeChange'
>;

interface RegisterWebSocketHandlersArgs {
  server: WebSocketApiServer;
  packageVersion: string;
  maxMessageLength: number;
  agentRuntime: WorkerCapableAgentRuntime;
  db: Database;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  agentRoleService?: AgentRoleService;
  channelManager: ChannelManager;
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  toolRegistry?: ToolRegistry;
  longTermMemoryStore: LongTermMemoryStore;
  pluginManager?: PluginManager;
  cronService?: CronRuntimeService;
  getMcpManager: () => McpClientManager | undefined;
  setMcpManager: (manager: McpClientManager | undefined) => void;
  skillManager?: SkillManager;
  eventBus: EventBus<AesyClawEvents>;
}

/**
 * WebSocket 入参允许为空或非对象，这里统一压成普通对象，避免各 handler 重复判空。
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * 某些能力按配置延迟装配，真正调用前再做依赖守卫，错误语义会更明确。
 */
function requireService<T>(service: T | undefined, name: string): T {
  if (!service) {
    throw new DependencyUnavailableError(`${name} is unavailable`);
  }

  return service;
}

/**
 * 详情订阅在目标已删除时不抛错，而是返回 `null`，方便前端直接清空当前视图。
 */
async function getSessionDetailSnapshot(
  sessionService: SessionService,
  key: string
): Promise<Awaited<ReturnType<SessionService['getSessionDetails']>> | null> {
  try {
    return await sessionService.getSessionDetails(key);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return null;
    }
    throw error;
  }
}

async function getSkillDetailSnapshot(
  skillsService: SkillsService,
  name: string
): Promise<Awaited<ReturnType<SkillsService['getSkill']>> | null> {
  try {
    return skillsService.getSkill(name);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return null;
    }
    throw error;
  }
}

async function getMcpDetailSnapshot(
  mcpService: McpService,
  name: string
): Promise<Awaited<ReturnType<McpService['getServer']>> | null> {
  try {
    return mcpService.getServer(name);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return null;
    }
    throw error;
  }
}

/**
 * 集中注册 WebSocket RPC、订阅，以及运行时事件到 topic 推送的映射关系。
 */
export function registerWebSocketHandlers(args: RegisterWebSocketHandlersArgs): () => void {
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
    skillManager,
    eventBus
  } = args;

  const getConfig = () => configStore.getConfig();
  const updateConfig = (mutator: (config: Config) => void | Config | Promise<void | Config>) =>
    configManager.update(mutator);

  // 各 feature service 继续复用原有业务层，这里只负责 transport 装配。
  const systemService = new SystemService(packageVersion, agentRuntime, sessionManager, channelManager, getConfig, toolRegistry);
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
  const channelsService = new ChannelsService(new ChannelRepository(channelManager, getConfig), maxMessageLength);
  const pluginsService = new PluginsService(new PluginRepository({
    pluginManager,
    channelManager,
    getConfig,
    updateConfig
  }));
  const observabilityService = new ObservabilityService(updateConfig);
  const memoryService = new MemoryService(new MemoryRepository(sessionManager, longTermMemoryStore, db));
  const mcpService = new McpService(new McpRepository({
    toolRegistry,
    getConfig,
    updateConfig,
    getMcpManager,
    setMcpManager
  }));
  const cronApiService = cronService ? new CronService(new CronRepository(cronService)) : undefined;
  const skillsService = skillManager ? new SkillsService(skillManager) : undefined;

  // RPC 负责显式查询和写操作，变更后按需触发订阅快照刷新。
  server.registerRpc('system.getStatus', () => systemService.getStatus());
  server.registerRpc('system.getTools', () => systemService.getTools());

  server.registerRpc('agents.list', () => agentsService.listAgents());
  server.registerRpc('agents.getWorkerRuntime', () => agentWorkersService.getSnapshot());
  server.registerRpc('agents.abortWorkerSession', (params) => {
    const sessionKey = String(asRecord(params).sessionKey || '').trim();
    if (!sessionKey) {
      throw new DomainValidationError('sessionKey is required', 'sessionKey');
    }
    return agentWorkersService.abortSession(sessionKey);
  });
  server.registerRpc('agents.create', async (params) => {
    const result = await agentsService.createAgent(parseAgentRoleInput(params));
    server.publish('agents.list');
    return result;
  });
  server.registerRpc('agents.update', async (params) => {
    const payload = asRecord(params);
    const name = String(payload.name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    const result = await agentsService.updateAgent(name, parseAgentRoleInput(payload, name));
    server.publish('agents.list');
    return result;
  });
  server.registerRpc('agents.delete', async (params) => {
    const name = String(asRecord(params).name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    const result = await agentsService.deleteAgent(name);
    server.publish('agents.list');
    return result;
  });

  server.registerRpc('sessions.list', async () => ({ sessions: await sessionService.listSessions() }));
  server.registerRpc('sessions.getDetail', async (params) => {
    const key = String(asRecord(params).key || '').trim();
    if (!key) {
      throw new DomainValidationError('key is required', 'key');
    }
    return sessionService.getSessionDetails(key);
  });
  server.registerRpc('sessions.delete', async (params) => {
    const key = String(asRecord(params).key || '').trim();
    if (!key) {
      throw new DomainValidationError('key is required', 'key');
    }
    return sessionService.deleteSession(key);
  });

  server.registerRpc('chat.createResponse', async (params) => chatService.createChatResponse(parseCreateChatRequest(params)));

  server.registerRpc('channels.getStatus', () => channelsService.getChannelStatus());
  server.registerRpc('channels.sendMessage', async (params) => {
    const payload = asRecord(params);
    const name = String(payload.name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    return channelsService.sendMessage(name, parseSendChannelMessage(payload));
  });

  server.registerRpc('config.get', () => sanitizePublicConfig(getConfig()));
  server.registerRpc('config.update', async (params) => {
    try {
      const currentConfig = getConfig();
      await configManager.update(
        () => preserveServerTokenInPublicConfig(parseConfigUpdate(params), currentConfig) as Config
      );
      const result = { success: true };
      server.publish('config.state');
      return result;
    } catch (error) {
      const issue = getConfigValidationIssue(error);
      if (issue) {
        throw new DomainValidationError(issue.message, issue.field);
      }
      throw error;
    }
  });

  server.registerRpc('skills.list', () => requireService(skillsService, 'Skill manager').listSkills());
  server.registerRpc('skills.get', (params) => {
    const name = String(asRecord(params).name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
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
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    const result = await requireService(skillsService, 'Skill manager').toggleSkill(name, parseToggleSkill(payload).enabled);
    server.publish('skills.list');
    server.publish('skills.detail', {
      match: (detailParams) => String(asRecord(detailParams).name || '').trim() === name
    });
    return result;
  });

  server.registerRpc('plugins.list', async () => pluginsService.listPlugins());
  server.registerRpc('plugins.toggle', async (params) => {
    const payload = asRecord(params);
    const name = String(payload.name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    const result = await pluginsService.togglePlugin(name, parseTogglePlugin(payload).enabled);
    server.publish('plugins.list');
    return result;
  });
  server.registerRpc('plugins.updateConfig', async (params) => {
    const payload = asRecord(params);
    const name = String(payload.name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    const result = await pluginsService.updatePluginConfig(name, parsePluginConfigUpdate(payload).options);
    server.publish('plugins.list');
    return result;
  });

  server.registerRpc('cron.list', async () => requireService(cronApiService, 'Cron service').listJobs());
  server.registerRpc('cron.get', async (params) => {
    const id = String(asRecord(params).id || '').trim();
    if (!id) {
      throw new DomainValidationError('id is required', 'id');
    }
    return requireService(cronApiService, 'Cron service').getJob(id);
  });
  server.registerRpc('cron.create', async (params) => {
    const result = await requireService(cronApiService, 'Cron service').createJob(parseCreateCronJob(params));
    server.publish('cron.list');
    return result;
  });
  server.registerRpc('cron.update', async (params) => {
    const payload = asRecord(params);
    const id = String(payload.id || '').trim();
    if (!id) {
      throw new DomainValidationError('id is required', 'id');
    }
    const result = await requireService(cronApiService, 'Cron service').updateJob(id, parseUpdateCronJob(payload));
    server.publish('cron.list');
    return result;
  });
  server.registerRpc('cron.delete', async (params) => {
    const id = String(asRecord(params).id || '').trim();
    if (!id) {
      throw new DomainValidationError('id is required', 'id');
    }
    const result = await requireService(cronApiService, 'Cron service').deleteJob(id);
    server.publish('cron.list');
    return result;
  });
  server.registerRpc('cron.toggle', async (params) => {
    const payload = asRecord(params);
    const id = String(payload.id || '').trim();
    if (!id) {
      throw new DomainValidationError('id is required', 'id');
    }
    const result = await requireService(cronApiService, 'Cron service').toggleJob(id, parseToggleCronJob(payload).enabled);
    server.publish('cron.list');
    return result;
  });

  server.registerRpc('mcp.list', () => mcpService.listServers());
  server.registerRpc('mcp.get', (params) => {
    const name = String(asRecord(params).name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    return mcpService.getServer(name);
  });
  server.registerRpc('mcp.create', async (params) => {
    const payload = asRecord(params);
    const name = String(payload.name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    const result = await mcpService.createServer(name, parseCreateMcpServer(payload.config ?? payload));
    server.publish('mcp.list');
    server.publish('mcp.detail', {
      match: (detailParams) => String(asRecord(detailParams).name || '').trim() === name
    });
    return result;
  });
  server.registerRpc('mcp.delete', async (params) => {
    const name = String(asRecord(params).name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    const result = await mcpService.deleteServer(name);
    server.publish('mcp.list');
    server.publish('mcp.detail', {
      match: (detailParams) => String(asRecord(detailParams).name || '').trim() === name
    });
    return result;
  });
  server.registerRpc('mcp.reconnect', async (params) => {
    const name = String(asRecord(params).name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    const result = await mcpService.reconnectServer(name);
    server.publish('mcp.list');
    server.publish('mcp.detail', {
      match: (detailParams) => String(asRecord(detailParams).name || '').trim() === name
    });
    return result;
  });
  server.registerRpc('mcp.toggle', async (params) => {
    const payload = asRecord(params);
    const name = String(payload.name || '').trim();
    if (!name) {
      throw new DomainValidationError('name is required', 'name');
    }
    const result = await mcpService.toggleServer(name, parseToggleMcpServer(payload).enabled);
    server.publish('mcp.list');
    server.publish('mcp.detail', {
      match: (detailParams) => String(asRecord(detailParams).name || '').trim() === name
    });
    return result;
  });

  server.registerRpc('memory.list', async () => memoryService.listMemory());
  server.registerRpc('memory.getHistory', async (params) => {
    const key = String(asRecord(params).key || '').trim();
    if (!key) {
      throw new DomainValidationError('key is required', 'key');
    }
    return memoryService.getHistory(key);
  });
  server.registerRpc('memory.deleteOne', async (params) => {
    const key = String(asRecord(params).key || '').trim();
    if (!key) {
      throw new DomainValidationError('key is required', 'key');
    }
    const result = await memoryService.deleteConversation(key);
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
    return observabilityService.getLoggingEntries(parseLoggingEntriesQuery({
      limit: payload.limit,
      level: payload.level
    }));
  });
  server.registerRpc('observability.setLogLevel', async (params) => {
    return observabilityService.updateLoggingLevel(parseLoggingLevelUpdate(params).level);
  });
  server.registerRpc('observability.getUsage', () => observabilityService.getUsage());
  server.registerRpc('observability.resetUsage', () => observabilityService.resetUsage());

  // 订阅只暴露“当前最新状态”，不额外维护历史事件流。
  server.registerSubscription('system.status', {
    getSnapshot: () => systemService.getStatus()
  });
  server.registerSubscription('system.tools', {
    getSnapshot: () => systemService.getTools()
  });
  server.registerSubscription('agents.list', {
    getSnapshot: () => agentsService.listAgents()
  });
  server.registerSubscription('config.state', {
    getSnapshot: () => sanitizePublicConfig(getConfig())
  });
  server.registerSubscription('skills.list', {
    getSnapshot: () => requireService(skillsService, 'Skill manager').listSkills()
  });
  server.registerSubscription('skills.detail', {
    getSnapshot: async (params) => {
      const name = String(asRecord(params).name || '').trim();
      if (!name) {
        throw new DomainValidationError('name is required', 'name');
      }
      return getSkillDetailSnapshot(requireService(skillsService, 'Skill manager'), name);
    }
  });
  server.registerSubscription('plugins.list', {
    getSnapshot: async () => pluginsService.listPlugins()
  });
  server.registerSubscription('cron.list', {
    getSnapshot: async () => requireService(cronApiService, 'Cron service').listJobs()
  });
  server.registerSubscription('mcp.list', {
    getSnapshot: () => mcpService.listServers()
  });
  server.registerSubscription('mcp.detail', {
    getSnapshot: async (params) => {
      const name = String(asRecord(params).name || '').trim();
      if (!name) {
        throw new DomainValidationError('name is required', 'name');
      }
      return getMcpDetailSnapshot(mcpService, name);
    }
  });
  server.registerSubscription('memory.list', {
    getSnapshot: async () => memoryService.listMemory()
  });
  server.registerSubscription('observability.logs', {
    getSnapshot: (params) => {
      const payload = asRecord(params);
      return observabilityService.getLoggingEntries(parseLoggingEntriesQuery({
        limit: payload.limit,
        level: payload.level
      }));
    }
  });
  server.registerSubscription('observability.usage', {
    getSnapshot: () => observabilityService.getUsage()
  });
  server.registerSubscription('agents.workerRuntime', {
    getSnapshot: () => agentWorkersService.getSnapshot()
  });
  server.registerSubscription('sessions.list', {
    getSnapshot: async () => ({ sessions: await sessionService.listSessions() })
  });
  server.registerSubscription('sessions.detail', {
    getSnapshot: async (params) => {
      const key = String(asRecord(params).key || '').trim();
      if (!key) {
        throw new DomainValidationError('key is required', 'key');
      }
      return getSessionDetailSnapshot(sessionService, key);
    }
  });

  const cleanups: Array<() => void> = [];

  // 把内部事件源桥接到对应 topic，前端依靠订阅自动收敛到最新快照。
  cleanups.push(logging.onEntry(() => {
    server.publish('observability.logs');
  }));
  cleanups.push(tokenUsage.onChange(() => {
    server.publish('observability.usage');
  }));
  cleanups.push(skillManager?.onChange(() => {
    server.publish('skills.list');
    server.publish('skills.detail');
  }) ?? (() => {}));
  cleanups.push(agentRuntime.onWorkerRuntimeChange(() => {
    server.publish('agents.workerRuntime');
  }));
  cleanups.push(sessionManager.onChange((event) => {
    server.publish('sessions.list');
    server.publish('system.status');
    server.publish('memory.list');
    server.publish('sessions.detail', {
      match: (params) => String(asRecord(params).key || '').trim() === event.sessionKey
    });
  }));
  cleanups.push(channelManager.onStatusChange(() => {
    server.publish('system.status');
  }));
  cleanups.push(eventBus.on('config.changed', () => {
    server.publish('system.status');
    server.publish('agents.list');
    server.publish('config.state');
    server.publish('skills.list');
    server.publish('skills.detail');
    server.publish('plugins.list');
    server.publish('mcp.list');
  }));
  cleanups.push(eventBus.on('mcp.tools.synced', () => {
    server.publish('system.status');
    server.publish('system.tools');
    server.publish('mcp.list');
    server.publish('mcp.detail');
  }));
  cleanups.push(eventBus.on('plugin.runtime.updated', () => {
    server.publish('system.status');
    server.publish('system.tools');
    server.publish('plugins.list');
  }));
  cleanups.push(eventBus.on('cron.job.executed', () => {
    server.publish('cron.list');
  }));
  cleanups.push(eventBus.on('cron.job.failed', () => {
    server.publish('cron.list');
  }));

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
