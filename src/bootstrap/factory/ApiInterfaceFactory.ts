import type { Config } from '../../types.js';
import { APIServer } from '../../api/index.js';
import type { AgentRuntime } from '../../agent/runtime/AgentRuntime.js';
import type { SessionManager, MemoryFactStore } from '../../session/index.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { PluginManager } from '../../plugins/index.js';
import type { CronService } from '../../cron/index.js';
import type { MCPClientManager } from '../../mcp/index.js';
import type { SkillManager } from '../../skills/index.js';
import type { ToolRegistry } from '../../tools/index.js';
import type { AgentRoleService } from '../../agent/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../../agent/session/SessionRoutingService.js';
import { logger } from '../../observability/index.js';

const log = logger.child('ApiInterfaceFactory');

export async function createApiServer(args: {
  config: Config;
  port: number;
  agentRuntime: AgentRuntime;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  channelManager: ChannelManager;
  pluginManager: PluginManager;
  cronService: CronService;
  mcpManager: MCPClientManager | null;
  skillManager: SkillManager | null;
  toolRegistry: ToolRegistry;
  memoryFactStore: MemoryFactStore;
  agentRoleService: AgentRoleService;
}): Promise<APIServer | undefined> {
  const { config, port, agentRuntime, sessionManager, sessionRouting, channelManager, pluginManager, cronService, mcpManager, skillManager, toolRegistry, memoryFactStore, agentRoleService } = args;

  if (config.server.apiEnabled === false) {
    log.info('API server disabled by configuration');
    return undefined;
  }

  const apiServer = new APIServer(
    port,
    agentRuntime,
    sessionManager,
    sessionRouting,
    channelManager,
    config,
    pluginManager,
    cronService,
    mcpManager ?? undefined,
    skillManager ?? undefined,
    toolRegistry,
    memoryFactStore,
    agentRoleService
  );
  await apiServer.start();
  log.info(`API server started on port ${port}`);
  return apiServer;
}
