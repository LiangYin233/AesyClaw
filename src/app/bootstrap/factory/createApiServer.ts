import type { AgentRoleService } from '../../../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../../../agent/infrastructure/session/SessionRoutingService.js';
import type { AgentRuntime } from '../../../agent/index.js';
import { APIServer } from '../../api/index.js';
import type { ChannelManager } from '../../../features/channels/application/ChannelManager.js';
import type { ConfigManager, RuntimeConfigStore } from '../../../features/config/index.js';
import type { CronRuntimeService } from '../../../features/cron/index.js';
import type { MCPClientManager } from '../../../features/mcp/index.js';
import type { Database } from '../../../platform/db/index.js';
import type { PluginManager } from '../../../features/plugins/index.js';
import type { LongTermMemoryStore, SessionManager } from '../../../features/sessions/index.js';
import type { SkillManager } from '../../../features/skills/index.js';
import type { ToolRegistry } from '../../../platform/tools/index.js';

export async function createApiServer(args: {
  port: number;
  agentRuntime: AgentRuntime;
  db: Database;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  channelManager: ChannelManager;
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  pluginManager: PluginManager;
  cronService: CronRuntimeService;
  mcpManager: MCPClientManager | null;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  longTermMemoryStore: LongTermMemoryStore;
  agentRoleService: AgentRoleService;
}): Promise<APIServer | undefined> {
  const {
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
  } = args;

  if (configStore.getConfig().server.apiEnabled === false) {
    return undefined;
  }

  const apiServer = new APIServer({
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
    mcpManager: mcpManager ?? undefined,
    skillManager,
    toolRegistry,
    longTermMemoryStore,
    agentRoleService
  });

  await apiServer.start();
  return apiServer;
}
