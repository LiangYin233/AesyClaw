export {
  getMainAgentConfig,
  getMainAgentRole,
  type ResolvedMainAgentConfig
} from './projections/mainAgent.js';
export {
  getMemoryConfig,
  getMemoryRecallConfig,
  getMemorySummaryConfig,
  getSessionRuntimeConfig,
  type ResolvedMemoryConfig,
  type ResolvedMemoryRecallConfig,
  type ResolvedMemorySummaryConfig
} from './projections/memory.js';
export { getObservabilityConfig } from './projections/observability.js';
export { getToolRuntimeConfig } from './projections/tools.js';
