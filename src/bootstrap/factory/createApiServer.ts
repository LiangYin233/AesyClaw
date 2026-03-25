import type { AgentRoleService } from '../../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../../agent/infrastructure/session/SessionRoutingService.js';
import type { AgentRuntime } from '../../agent/index.js';
import { APIServer } from '../../api/index.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { ConfigManager, RuntimeConfigStore } from '../../config/index.js';
import type { CronService } from '../../cron/index.js';
import type { MCPClientManager } from '../../mcp/index.js';
import type { PluginManager } from '../../plugins/index.js';
import type { LongTermMemoryStore, SessionManager } from '../../session/index.js';
import type { SkillManager } from '../../skills/index.js';
import type { ToolRegistry } from '../../tools/index.js';

export async function createApiServer(args: {
  port: number;
  agentRuntime: AgentRuntime;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  channelManager: ChannelManager;
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  pluginManager: PluginManager;
  cronService: CronService;
  mcpManager: MCPClientManager | null;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  longTermMemoryStore: LongTermMemoryStore;
  agentRoleService: AgentRoleService;
}): Promise<APIServer | undefined> {
  const {
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
  } = args;

  if (configStore.getConfig().server.apiEnabled === false) {
    return undefined;
  }

  const apiServer = new APIServer({
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

  await apiServer.start();
  return apiServer;
}
