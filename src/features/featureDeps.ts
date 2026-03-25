import type { Express } from 'express';
import type { AgentRuntime } from '../agent/index.js';
import type { AgentRoleService } from '../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../agent/infrastructure/session/SessionRoutingService.js';
import type { ChannelManager } from './channels/application/ChannelManager.js';
import type { Config } from '../types.js';
import type { Database } from '../platform/db/index.js';
import type { ToolRegistry } from '../platform/tools/ToolRegistry.js';
import type { SessionManager } from './sessions/application/SessionManager.js';
import type { LongTermMemoryStore } from './sessions/infrastructure/LongTermMemoryStore.js';
import type { PluginManager } from './plugins/index.js';
import type { CronRuntimeService } from './cron/index.js';
import type { MCPClientManager } from './mcp/index.js';
import type { SkillManager } from './skills/application/SkillManager.js';

export interface ApiFeatureControllerDeps {
  app: Express;
  packageVersion: string;
  maxMessageLength: number;
  agentRuntime: Pick<AgentRuntime, 'handleDirect' | 'isRunning'>;
  db: Database;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  agentRoleService?: AgentRoleService;
  channelManager: ChannelManager;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
  toolRegistry?: ToolRegistry;
  longTermMemoryStore: LongTermMemoryStore;
  pluginManager?: PluginManager;
  cronService?: CronRuntimeService;
  getMcpManager: () => MCPClientManager | undefined;
  setMcpManager: (manager: MCPClientManager) => void;
  skillManager?: SkillManager;
  log: {
    info(message: string, ...args: any[]): void;
  };
}
