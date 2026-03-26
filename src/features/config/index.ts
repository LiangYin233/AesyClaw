export { ConfigManager, defaultConfigService, getConfig, defaultConfigService as ConfigLoader } from './ConfigManager.js';
export type { ConfigMutator } from './application/ConfigMutationService.js';
export { RuntimeConfigStore } from './RuntimeConfigStore.js';
export {
  DEFAULT_CONFIG,
  configSchema,
  createDefaultConfig,
  getConfigValidationIssue,
  parseConfig,
  parseMCPServerConfig
} from './schema/index.js';
export { resolveConfig, resolveProviderSelection } from './resolve.js';
export { resolveExecutionModel } from './modelRef.js';
export {
  getMainAgentConfig,
  getMainAgentRole,
  type ResolvedMainAgentConfig
} from './domain/mainAgent.js';
export {
  getMemoryConfig,
  getMemoryRecallConfig,
  getMemorySummaryConfig,
  getSessionRuntimeConfig
} from './domain/memory.js';
export { getObservabilityConfig } from './domain/observability.js';
export { getToolRuntimeConfig } from './domain/tools.js';
export { isEmbeddingCapableProvider, listEmbeddingProviderNames } from './schema/providers.js';
export type {
  AgentConfig,
  AgentRoleConfig,
  AgentsConfig,
  ChannelConfig,
  Config,
  ConfigValidationIssue,
  ContextMode,
  LoggingConfig,
  MCPServerConfig,
  MCPServersConfig,
  MCPTransportType,
  MemoryFactsConfig,
  MemorySummaryConfig,
  ObservabilityConfig,
  PluginConfig,
  ProviderConfig,
  RawConfig,
  ResolvedProviderSelection,
  ServerConfig,
  SkillConfig,
  ToolsConfig,
} from './schema/index.js';
export type { ResolvedConfig } from './resolve.js';
export type {
  ResolvedMemoryConfig,
  ResolvedMemoryRecallConfig,
  ResolvedMemorySummaryConfig
} from './domain/memory.js';
export { registerConfigFeature } from './runtime/registerConfigFeature.js';
export type { ConfigFeatureDeps } from './runtime/registerConfigFeature.js';
