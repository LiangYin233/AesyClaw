import type { Config } from '../../../types.js';
import type { AgentRuntime } from '../../../agent/index.js';
import type { AgentRoleService } from '../../../features/agents/infrastructure/AgentRoleService.js';
import type { ISessionRouting } from '../../../agent/domain/session.js';
import type { ChannelManager } from '../../../features/extension/channel/ChannelManager.js';
import type { ConfigManager, RuntimeConfigStore } from '../../../features/config/index.js';
import type { Database } from '../../../platform/db/index.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import type { SessionManager } from '../../../agent/infrastructure/session/SessionManager.js';
import type { LongTermMemoryStore } from '../../../features/memory/infrastructure/LongTermMemoryStore.js';
import type { PluginCoordinator } from '../../../features/extension/plugin/index.js';
import type { CronRuntimeService } from '../../../features/cron/index.js';
import type { McpClientManager } from '../../../features/mcp/index.js';
import type { SkillManager } from '../../../features/skills/application/SkillManager.js';
import type { EventBus } from '../../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../../platform/events/events.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import type { Logger } from '../../../platform/observability/logging.js';
import type { CronJob } from '../../../features/cron/index.js';

export interface RuntimeServices {
  agentRuntime: AgentRuntime;
  sessionManager: SessionManager;
  sessionRouting: ISessionRouting;
}

export interface MessagingServices {
  channelManager: ChannelManager;
  pluginManager: PluginCoordinator;
  mcpManager: McpClientManager | null;
}

export interface ToolServices {
  toolRegistry: ToolRegistry;
  skillManager: SkillManager | null;
}

export interface ConfigServices {
  config: Config;
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  eventBus: EventBus<AesyClawEvents>;
}

export interface Services extends 
  RuntimeServices,
  MessagingServices,
  ToolServices,
  ConfigServices {
  provider?: LLMProvider;
  longTermMemoryStore: LongTermMemoryStore;
  cronService: CronRuntimeService;
  workspace: string;
  webServer?: import('../../ws/WebServer.js').WebServer;
  startPluginLoading: () => void;
  isPluginLoadingComplete: () => boolean;
}

export interface ServiceFactoryOptions {
  workspace: string;
  tempDir: string;
  config: Config;
  configManager: ConfigManager;
  eventBus: EventBus<AesyClawEvents>;
  port: number;
  onCronJob: (job: CronJob) => Promise<void>;
}

export interface BootstrapPhaseOptions<T> {
  phase: string;
  log: Logger;
  task: () => Promise<T>;
}
