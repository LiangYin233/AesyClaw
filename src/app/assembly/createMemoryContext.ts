import { LongTermMemoryService } from '../../features/memory/infrastructure/LongTermMemoryService.js';
import { OpenAIEmbeddingsClient } from '../../features/memory/infrastructure/OpenAIEmbeddingsClient.js';
import { SessionMemoryService } from '../../features/memory/infrastructure/SessionMemoryService.js';
import type { MemoryContext, SessionManager, LongTermMemoryStore } from '../../platform/context/index.js';
import type { Config } from '../../types.js';
import { getMemoryConfig, listEmbeddingProviderNames, resolveProviderSelection } from '../../features/config/index.js';
import type { ResolvedProviderSelection } from '../../features/config/schema/index.js';
import { createProvider } from '../../platform/providers/index.js';

function createOptionalProvider(resolved: ResolvedProviderSelection | undefined, label: string) {
  if (!resolved?.providerConfig) {
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

export function createMemoryContext(
  config: Config,
  sessionManager: SessionManager,
  longTermMemoryStore: LongTermMemoryStore
): MemoryContext {
  const memoryConfig = getMemoryConfig(config);
  const summaryConfig = memoryConfig.summary;
  const sessionConfig = memoryConfig.session;

  const maintenanceSelection = memoryConfig.facts.maintenance.provider && memoryConfig.facts.maintenance.model
    ? resolveProviderSelection(config, `${memoryConfig.facts.maintenance.provider}/${memoryConfig.facts.maintenance.model}`)
    : undefined;
  const recallSelection = memoryConfig.facts.recall.provider && memoryConfig.facts.recall.model
    ? resolveProviderSelection(config, `${memoryConfig.facts.recall.provider}/${memoryConfig.facts.recall.model}`)
    : undefined;

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

  const memoryService = new SessionMemoryService(
    sessionManager as any,
    summaryConfig.enabled && summaryConfig.provider && summaryConfig.model
      ? createOptionalProvider(resolveProviderSelection(config, `${summaryConfig.provider}/${summaryConfig.model}`), '记忆摘要')
      : undefined,
    {
      enabled: summaryConfig.enabled,
      model: summaryConfig.model,
      compressRounds: summaryConfig.compressRounds,
      memoryWindow: sessionConfig.memoryWindow,
      contextMode: sessionConfig.contextMode
    },
    longTermMemoryService
  );

  return { memoryService: memoryService as unknown as MemoryContext['memoryService'] };
}
