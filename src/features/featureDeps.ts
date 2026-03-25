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
