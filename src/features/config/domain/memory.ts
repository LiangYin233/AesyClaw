import { tryParseModelRef } from '../modelRef.js';
import { resolveProviderSelection } from '../resolve.js';
import type { ContextMode, ProviderConfig } from '../schema/index.js';
import { isEmbeddingCapableProvider } from '../schema/providers.js';
import { readConfig, type ConfigSource } from './shared.js';

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
