import type { VisionSettings } from '../types.js';
import { isEmbeddingCapableProvider } from './providerCapabilities.js';
import { resolveProviderSelection } from './resolve.js';
import { MAIN_AGENT_NAME } from './schema/shared.js';
import type {
  AgentRoleConfig,
  Config,
  ContextMode,
  ObservabilityConfig,
  ProviderConfig,
  ResolvedProviderSelection,
  ToolsConfig
} from './schema/index.js';

type ConfigSource = Config | { getConfig(): Config };

function readConfig(source: ConfigSource): Config {
  if (typeof (source as { getConfig?: () => Config }).getConfig === 'function') {
    return (source as { getConfig: () => Config }).getConfig();
  }

  return source as Config;
}

export type ResolvedMemorySummaryConfig = {
  enabled: boolean;
  provider?: string;
  model?: string;
  compressRounds: number;
};

export type ResolvedMemoryMaintenanceConfig = {
  enabled: boolean;
  provider?: string;
  model?: string;
  providerConfig?: ProviderConfig;
};

export type ResolvedMemoryRecallConfig = {
  enabled: boolean;
  provider?: string;
  model?: string;
  providerConfig?: ProviderConfig;
  threshold: number;
  topK: number;
};

export type ResolvedMemoryConfig = {
  summary: ResolvedMemorySummaryConfig;
  facts: {
    enabled: boolean;
    maintenance: ResolvedMemoryMaintenanceConfig;
    recall: ResolvedMemoryRecallConfig;
  };
  session: {
    memoryWindow: number;
    contextMode: ContextMode;
    maxSessions: number;
  };
};

export type ResolvedMainAgentConfig = {
  role: AgentRoleConfig;
  provider: ResolvedProviderSelection;
  maxIterations: number;
  memoryWindow: number;
  visionSettings: VisionSettings;
  visionProvider?: ResolvedProviderSelection;
};

export function getMainAgentRole(source: ConfigSource): AgentRoleConfig {
  const config = readConfig(source);
  return config.agents.roles[MAIN_AGENT_NAME];
}

export function getMainAgentConfig(source: ConfigSource): ResolvedMainAgentConfig {
  const config = readConfig(source);
  const role = getMainAgentRole(config);
  const provider = resolveProviderSelection(config, role.provider, role.model);
  const visionProvider = role.vision && role.visionProvider && role.visionModel
    ? resolveProviderSelection(config, role.visionProvider, role.visionModel)
    : undefined;

  return {
    role,
    provider,
    maxIterations: config.agent.defaults.maxToolIterations,
    memoryWindow: config.agent.defaults.memoryWindow,
    visionSettings: {
      enabled: role.vision,
      reasoning: role.reasoning,
      visionProviderName: role.visionProvider || undefined,
      visionModelName: role.visionModel || undefined
    },
    visionProvider
  };
}

export function getMemoryConfig(source: ConfigSource): ResolvedMemoryConfig {
  const config = readConfig(source);
  const defaults = config.agent.defaults;
  const summary = defaults.memorySummary;
  const facts = defaults.memoryFacts;
  const maintenanceProvider = facts.provider.trim();
  const maintenanceModel = facts.model.trim();
  const recallProvider = facts.retrievalProvider.trim();
  const recallModel = facts.retrievalModel.trim();
  const recallProviderConfig = recallProvider ? config.providers[recallProvider] : undefined;

  return {
    summary: {
      enabled: summary.enabled && !!summary.provider.trim() && !!summary.model.trim(),
      provider: summary.provider.trim() || undefined,
      model: summary.model.trim() || undefined,
      compressRounds: summary.compressRounds
    },
    facts: {
      enabled: facts.enabled,
      maintenance: {
        enabled: facts.enabled && !!maintenanceProvider && !!maintenanceModel,
        provider: maintenanceProvider || undefined,
        model: maintenanceModel || undefined,
        providerConfig: maintenanceProvider ? config.providers[maintenanceProvider] : undefined
      },
      recall: {
        enabled: facts.enabled
          && !!recallProvider
          && !!recallModel
          && isEmbeddingCapableProvider(recallProviderConfig),
        provider: recallProvider || undefined,
        model: recallModel || undefined,
        providerConfig: recallProviderConfig,
        threshold: facts.retrievalThreshold,
        topK: facts.retrievalTopK
      }
    },
    session: {
      memoryWindow: defaults.memoryWindow,
      contextMode: defaults.contextMode,
      maxSessions: defaults.maxSessions
    }
  };
}

export function getMemorySummaryConfig(source: ConfigSource): ResolvedMemorySummaryConfig {
  return getMemoryConfig(source).summary;
}

export function getMemoryRecallConfig(source: ConfigSource): ResolvedMemoryRecallConfig {
  return getMemoryConfig(source).facts.recall;
}

export function getSessionRuntimeConfig(source: ConfigSource): ResolvedMemoryConfig['session'] {
  return getMemoryConfig(source).session;
}

export function getToolRuntimeConfig(source: ConfigSource): ToolsConfig {
  return readConfig(source).tools;
}

export function getObservabilityConfig(source: ConfigSource): ObservabilityConfig {
  return readConfig(source).observability;
}
