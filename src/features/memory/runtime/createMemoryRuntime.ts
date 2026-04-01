import { LongTermMemoryService } from '../infrastructure/LongTermMemoryService.js';
import { OpenAIEmbeddingsClient } from '../infrastructure/OpenAIEmbeddingsClient.js';
import { SessionMemoryService } from '../infrastructure/SessionMemoryService.js';
import type { SessionManager, LongTermMemoryStore } from '../../../platform/context/index.js';
import {
  getMemoryConfig,
  listEmbeddingProviderNames,
  resolveProviderSelection
} from '../../config/index.js';
import type { ResolvedProviderSelection } from '../../config/schema/index.js';
import { createProvider } from '../../../platform/providers/index.js';
import type { Config } from '../../../types.js';

function createOptionalProvider(resolved: ResolvedProviderSelection, _label: string) {
  if (!resolved.providerConfig) {
    return undefined;
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

function createEmbeddingsClient(resolved: ResolvedProviderSelection | undefined): OpenAIEmbeddingsClient | undefined {
  if (!resolved?.providerConfig) {
    return undefined;
  }

  if (!listEmbeddingProviderNames({ [resolved.name]: resolved.providerConfig }).length) {
    return undefined;
  }

  return new OpenAIEmbeddingsClient({
    apiKey: resolved.providerConfig.apiKey,
    apiBase: resolved.providerConfig.apiBase,
    headers: resolved.providerConfig.headers
  });
}

export function createMemoryRuntime(
  config: Config,
  sessionManager: SessionManager,
  longTermMemoryStore: LongTermMemoryStore
): SessionMemoryService | undefined {
  const memoryConfig = getMemoryConfig(config);
  const summaryConfig = memoryConfig.summary;
  const sessionConfig = memoryConfig.session;
  const maintenanceSelection = memoryConfig.facts.maintenance.provider && memoryConfig.facts.maintenance.model
    ? resolveProviderSelection(config, `${memoryConfig.facts.maintenance.provider}/${memoryConfig.facts.maintenance.model}`)
    : undefined;
  const recallSelection = memoryConfig.facts.recall.provider && memoryConfig.facts.recall.model
    ? resolveProviderSelection(config, `${memoryConfig.facts.recall.provider}/${memoryConfig.facts.recall.model}`)
    : undefined;

  if (!summaryConfig.enabled && !memoryConfig.facts.enabled) {
    return undefined;
  }

  if (!summaryConfig.enabled && config.agent.defaults.memorySummary.enabled) {
  }

  const summaryRuntimeConfig = {
    enabled: summaryConfig.enabled,
    model: summaryConfig.model,
    compressRounds: summaryConfig.compressRounds,
    memoryWindow: sessionConfig.memoryWindow,
    contextMode: sessionConfig.contextMode
  };

  const longTermMemoryService = memoryConfig.facts.enabled
    ? new LongTermMemoryService(
        sessionManager as any,
        longTermMemoryStore as any,
        {
          enabled: memoryConfig.facts.enabled,
          model: memoryConfig.facts.maintenance.model,
          retrievalProvider: memoryConfig.facts.recall.provider,
          retrievalModel: memoryConfig.facts.recall.model,
          retrievalThreshold: memoryConfig.facts.recall.threshold,
          retrievalTopK: memoryConfig.facts.recall.topK
        },
        maintenanceSelection
          ? createOptionalProvider(maintenanceSelection, '长期记忆')
          : undefined,
        recallSelection
          ? createEmbeddingsClient(recallSelection)
          : undefined
      )
    : undefined;

  return new SessionMemoryService(
    sessionManager as any,
    summaryConfig.enabled && summaryConfig.provider && summaryConfig.model
      ? createOptionalProvider(resolveProviderSelection(config, `${summaryConfig.provider}/${summaryConfig.model}`), '记忆摘要')
      : undefined,
    summaryRuntimeConfig,
    longTermMemoryService
  );
}
