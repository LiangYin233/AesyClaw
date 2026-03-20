import type { Config, VisionSettings } from '../../../types.js';
import type { RuntimeConfigStore } from '../../../config/RuntimeConfigStore.js';
import type { AgentRuntime } from '../../runtime/AgentRuntime.js';
import type { SessionRoutingService } from '../../session/SessionRoutingService.js';
import type { ToolRegistry } from '../../../tools/ToolRegistry.js';
import type { APIServer } from '../../../api/server.js';
import type { MCPClientManager } from '../../../mcp/MCPClient.js';
import type { SessionManager } from '../../../session/SessionManager.js';
import type { LongTermMemoryStore } from '../../../session/LongTermMemoryStore.js';
import type { SkillManager } from '../../../skills/SkillManager.js';
import type { LLMProvider } from '../../../providers/base.js';

export interface ReloadRuntimeConfigDeps {
  configStore: RuntimeConfigStore;
  agentRuntime: Pick<AgentRuntime, 'updateMainAgentRuntime' | 'updateMemorySettings'>;
  sessionRouting: Pick<SessionRoutingService, 'setContextMode'>;
  toolRegistry: Pick<ToolRegistry, 'setDefaultTimeout' | 'register' | 'list' | 'unregisterMany'>;
  apiServer?: Pick<APIServer, 'updateConfig'>;
  mcpManager: MCPClientManager | null;
  setMcpManager: (manager: MCPClientManager) => void;
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  skillManager?: Pick<SkillManager, 'applyConfig'> | null;
  createProvider: (providerName: string, providerConfig: Config['providers'][string]) => LLMProvider;
  createMemoryService: (config: Config, sessionManager: SessionManager, longTermMemoryStore: LongTermMemoryStore) => unknown;
  syncConfiguredMcpServers: (binding: {
    getMcpManager: () => MCPClientManager | undefined;
    setMcpManager: (manager: MCPClientManager) => void;
    toolRegistry: Pick<ToolRegistry, 'register' | 'list' | 'unregisterMany'>;
  }, config: Config) => Promise<void>;
  logging: {
    configure: (config: { level?: 'debug' | 'info' | 'warn' | 'error' }) => void;
  };
  logger: {
    info(message: string, fields?: Record<string, unknown>): void;
    debug(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
  };
  selectors: {
    getMainAgentConfig: typeof import('../../../config/index.js').getMainAgentConfig;
    getMemoryConfig: typeof import('../../../config/index.js').getMemoryConfig;
    getObservabilityConfig: typeof import('../../../config/index.js').getObservabilityConfig;
    getSessionRuntimeConfig: typeof import('../../../config/index.js').getSessionRuntimeConfig;
    getToolRuntimeConfig: typeof import('../../../config/index.js').getToolRuntimeConfig;
  };
}

export interface ReloadRule {
  key: string;
  hasChanged: (currentConfig: Config, nextConfig: Config) => boolean;
  describe?: (currentConfig: Config, nextConfig: Config) => Record<string, unknown> | undefined;
  apply: (deps: ReloadRuntimeConfigDeps, nextConfig: Config) => Promise<void> | void;
}

export type CreateVisionProvider = (config: Config, settings: VisionSettings) => LLMProvider | undefined;
