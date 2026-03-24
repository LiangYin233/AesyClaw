import type { VisionSettings } from '../types.js';
import { tryParseModelRef } from './modelRef.js';
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
  const provider = resolveProviderSelection(config, role.model);
  const directVision = provider.modelConfig?.supportsVision === true;
  const fallbackModelRef = config.agent.defaults.visionFallbackModel.trim() || undefined;
  const visionProvider = !directVision && fallbackModelRef
    ? resolveProviderSelection(config, fallbackModelRef)
    : undefined;

  return {
    role,
    provider,
    maxIterations: config.agent.defaults.maxToolIterations,
    memoryWindow: config.agent.defaults.memoryWindow,
    visionSettings: {
      enabled: directVision || !!visionProvider,
      directVision,
      reasoning: visionProvider?.modelConfig?.reasoning === true,
      fallbackModelRef,
      fallbackProviderName: visionProvider?.name,
      fallbackModelName: visionProvider?.model
    },
    visionProvider
  };
}

export function getMemoryConfig(source: ConfigSource): ResolvedMemoryConfig {
  const config = readConfig(source);
  const defaults = config.agent.defaults;
  const summary = defaults.memorySummary;
  const facts = defaults.memoryFacts;
  const summarySelection = tryParseModelRef(summary.model)
    ? resolveProviderSelection(config, summary.model)
    : undefined;
  const maintenanceSelection = tryParseModelRef(facts.model)
    ? resolveProviderSelection(config, facts.model)
    : undefined;
  const recallSelection = tryParseModelRef(facts.retrievalModel)
    ? resolveProviderSelection(config, facts.retrievalModel)
    : undefined;
  const recallProviderConfig = recallSelection?.providerConfig;

  return {
    summary: {
      enabled: summary.enabled && !!summarySelection?.providerConfig && !!summarySelection.model,
      provider: summarySelection?.name,
      model: summarySelection?.model,
      compressRounds: summary.compressRounds
    },
    facts: {
      enabled: facts.enabled,
      maintenance: {
        enabled: facts.enabled && !!maintenanceSelection?.providerConfig && !!maintenanceSelection.model,
        provider: maintenanceSelection?.name,
        model: maintenanceSelection?.model,
        providerConfig: maintenanceSelection?.providerConfig
      },
      recall: {
        enabled: facts.enabled
          && !!recallSelection?.name
          && !!recallSelection?.model
          && isEmbeddingCapableProvider(recallProviderConfig),
        provider: recallSelection?.name,
        model: recallSelection?.model,
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
