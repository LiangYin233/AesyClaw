import type { AgentRoleService } from '../../../agent/infrastructure/roles/AgentRoleService.js';
import type { ISessionRouting } from '../../../agent/domain/session.js';
import type { AgentRuntime } from '../../../agent/index.js';
import { WebServer } from '../../ws/WebServer.js';
import type { ChannelManager } from '../../../features/channels/application/ChannelManager.js';
import type { ConfigManager, RuntimeConfigStore } from '../../../features/config/index.js';
import type { CronRuntimeService } from '../../../features/cron/index.js';
import type { McpClientManager } from '../../../features/mcp/index.js';
import type { Database } from '../../../platform/db/index.js';
import type { PluginManager } from '../../../features/plugins/index.js';
import type { LongTermMemoryStore, SessionManager } from '../../../features/sessions/index.js';
import type { SkillManager } from '../../../features/skills/index.js';
import type { ToolRegistry } from '../../../platform/tools/index.js';
import type { EventBus } from '../../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../../platform/events/events.js';

export async function createWebServer(args: {
  port: number;
  agentRuntime: AgentRuntime;
  db: Database;
  sessionManager: SessionManager;
  sessionRouting: ISessionRouting;
  channelManager: ChannelManager;
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  pluginManager: PluginManager;
  cronService: CronRuntimeService;
  mcpManager: McpClientManager | null;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  longTermMemoryStore: LongTermMemoryStore;
  agentRoleService: AgentRoleService;
  eventBus: EventBus<AesyClawEvents>;
}): Promise<WebServer | undefined> {
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
    agentRoleService,
    eventBus
  } = args;

  if (configStore.getConfig().server.apiEnabled === false) {
    return undefined;
  }

  const webServer = new WebServer({
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
    agentRoleService,
    eventBus
  });

  await webServer.start();
  return webServer;
}
