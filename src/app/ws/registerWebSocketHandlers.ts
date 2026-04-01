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
import type { EventBus } from '../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../platform/events/events.js';
import { WebSocketApiServer } from './WebSocketApiServer.js';
import { registerRpcHandlers } from './registerRpcHandlers.js';
import { registerSubscriptions } from './registerSubscriptions.js';
import { registerEventBridges } from './registerEventBridges.js';

type WorkerCapableAgentRuntime = Pick<RuntimeCoordinator, 'handleDirect' | 'isRunning' | 'abortSession' | 'getWorkerRuntimeSnapshot' | 'onWorkerRuntimeChange'>;

export interface RegisterWebSocketHandlersArgs {
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
  eventBus: EventBus<AesyClawEvents>;
}

export function registerWebSocketHandlers(args: RegisterWebSocketHandlersArgs): () => void {
  registerRpcHandlers(args);
  registerSubscriptions(args);
  const cleanupEventBridges = registerEventBridges(args);
  return cleanupEventBridges;
}
