import type { Express } from 'express';
import type { AgentRuntime } from '../agent/index.js';
import type { AgentRoleService } from '../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../agent/infrastructure/session/SessionRoutingService.js';
import type { ChannelManager } from '../channels/ChannelManager.js';
import type { Config } from '../types.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { LongTermMemoryStore } from '../session/LongTermMemoryStore.js';
import type { PluginManager } from '../plugins/index.js';
import type { CronService } from '../cron/index.js';
import type { MCPClientManager } from '../mcp/MCPClient.js';
import type { SkillManager } from '../skills/SkillManager.js';
import { AgentApiService } from './agents/AgentApiService.js';
import { AgentRepository } from './agents/AgentRepository.js';
import { registerAgentsController } from './agents/agents.controller.js';
import { ChannelApiService } from './channels/ChannelApiService.js';
import { ChannelRepository } from './channels/ChannelRepository.js';
import { registerChannelsController } from './channels/channels.controller.js';
import { ChatApiService } from './chat/ChatApiService.js';
import { ChatRepository } from './chat/ChatRepository.js';
import { registerChatController } from './chat/chat.controller.js';
import { ConfigApiService } from './config/ConfigApiService.js';
import { ConfigRepository } from './config/ConfigRepository.js';
import { registerConfigController } from './config/config.controller.js';
import { CronApiService } from './cron/CronApiService.js';
import { CronRepository } from './cron/CronRepository.js';
import { registerCronController } from './cron/cron.controller.js';
import { McpApiService } from './mcp/McpApiService.js';
import { McpRepository } from './mcp/McpRepository.js';
import { registerMcpController } from './mcp/mcp.controller.js';
import { MemoryApiService } from './memory/MemoryApiService.js';
import { MemoryRepository } from './memory/MemoryRepository.js';
import { registerMemoryController } from './memory/memory.controller.js';
import { ObservabilityApiService } from './observability/ObservabilityApiService.js';
import { ObservabilityRepository } from './observability/ObservabilityRepository.js';
import { registerObservabilityController } from './observability/observability.controller.js';
import { PluginApiService } from './plugins/PluginApiService.js';
import { PluginRepository } from './plugins/PluginRepository.js';
import { registerPluginsController } from './plugins/plugins.controller.js';
import { ConversationAgentRepository } from './sessions/ConversationAgentRepository.js';
import { SessionApiService } from './sessions/SessionApiService.js';
import { SessionsRepository } from './sessions/SessionsRepository.js';
import { registerSessionsController } from './sessions/sessions.controller.js';
import { SkillApiService } from './skills/SkillApiService.js';
import { SkillRepository } from './skills/SkillRepository.js';
import { registerSkillsController } from './skills/skills.controller.js';
import { SystemApiService } from './system/SystemApiService.js';
import { SystemRepository } from './system/SystemRepository.js';
import { registerSystemController } from './system/system.controller.js';

export interface ApiFeatureControllerDeps {
  app: Express;
  packageVersion: string;
  maxMessageLength: number;
  agentRuntime: Pick<AgentRuntime, 'handleDirect' | 'isRunning'>;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  agentRoleService?: AgentRoleService;
  channelManager: ChannelManager;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
  toolRegistry?: ToolRegistry;
  longTermMemoryStore: LongTermMemoryStore;
  pluginManager?: PluginManager;
  cronService?: CronService;
  getMcpManager: () => MCPClientManager | undefined;
  setMcpManager: (manager: MCPClientManager) => void;
  skillManager?: SkillManager;
  log: {
    info(message: string, ...args: any[]): void;
  };
}

export function registerApiControllers(deps: ApiFeatureControllerDeps): void {
  const channelRepository = new ChannelRepository(deps.channelManager, deps.getConfig);
  const channelService = new ChannelApiService(channelRepository, deps.maxMessageLength);
  const sessionsRepository = new SessionsRepository(deps.sessionManager);
  const conversationAgentRepository = new ConversationAgentRepository(
    deps.sessionRouting,
    deps.agentRoleService
  );
  const sessionService = new SessionApiService(
    sessionsRepository,
    conversationAgentRepository
  );
  const chatService = new ChatApiService(new ChatRepository(deps.agentRuntime), deps.maxMessageLength);
  const systemService = new SystemApiService(
    deps.packageVersion,
    new SystemRepository(
      deps.agentRuntime,
      deps.sessionManager,
      deps.channelManager,
      deps.getConfig,
      deps.toolRegistry
    )
  );
  const agentService = new AgentApiService(
    new AgentRepository(deps.sessionRouting, deps.agentRoleService)
  );
  const configService = new ConfigApiService(new ConfigRepository(deps.getConfig, deps.updateConfig));
  const memoryService = new MemoryApiService(
    new MemoryRepository(deps.sessionManager, deps.longTermMemoryStore)
  );

  registerSystemController(deps.app, systemService);
  registerSessionsController(deps.app, sessionService);
  registerAgentsController(deps.app, agentService);
  registerChatController(deps.app, chatService, deps.log);
  registerChannelsController(deps.app, channelService, deps.log);
  registerConfigController(deps.app, configService, deps.log);
  registerMemoryController(deps.app, memoryService);

  if (deps.skillManager) {
    registerSkillsController(deps.app, new SkillApiService(new SkillRepository(deps.skillManager)));
  }

  registerPluginsController(
    deps.app,
    new PluginApiService(new PluginRepository({
      pluginManager: deps.pluginManager,
      channelManager: deps.channelManager,
      getConfig: deps.getConfig,
      updateConfig: deps.updateConfig
    }))
  );

  if (deps.cronService) {
    registerCronController(deps.app, new CronApiService(new CronRepository(deps.cronService)));
  }

  registerMcpController(
    deps.app,
    new McpApiService(new McpRepository({
      toolRegistry: deps.toolRegistry,
      getConfig: deps.getConfig,
      updateConfig: deps.updateConfig,
      getMcpManager: deps.getMcpManager,
      setMcpManager: deps.setMcpManager
    }))
  );
  registerObservabilityController(
    deps.app,
    new ObservabilityApiService(new ObservabilityRepository(deps.updateConfig))
  );
}
