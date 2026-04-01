import { LongTermMemoryService } from '../infrastructure/LongTermMemoryService.js';
import { OpenAIEmbeddingsClient } from '../infrastructure/OpenAIEmbeddingsClient.js';
import { SessionMemoryService } from '../infrastructure/SessionMemoryService.js';
import type { SessionManager, LongTermMemoryStore } from '../../../platform/context/index.js';
import { listEmbeddingProviderNames } from '../../../platform/context/index.js';
import { getMemoryConfig } from '../../../features/config/index.js';
import type { ConfigSource } from '../../../features/config/domain/shared.js';
import type { ResolvedProviderSelection } from '../../../features/config/schema/index.js';
import { createProvider } from '../../../platform/providers/index.js';

function createOptionalProvider(resolved: ResolvedProviderSelection | undefined, _label: string) {
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

function resolveProviderFromConfig(
  config: import('../../../types.js').Config,
  provider: string | undefined,
  model: string | undefined
): ResolvedProviderSelection | undefined {
  if (!provider || !model) {
    return undefined;
  }
  return { name: provider, model, providerConfig: config.providers[provider] };
}

export function createMemoryRuntime(
  source: ConfigSource,
  sessionManager: SessionManager,
  longTermMemoryStore: LongTermMemoryStore
): SessionMemoryService | undefined {
  const memoryConfig = getMemoryConfig(source);
  const { summary, facts, session } = memoryConfig;

  if (!summary.enabled && !facts.enabled) {
    return undefined;
  }

  const summaryRuntimeConfig = {
    enabled: summary.enabled,
    model: summary.model,
    compressRounds: summary.compressRounds,
    memoryWindow: session.memoryWindow,
    contextMode: session.contextMode
  };

  const maintenanceProvider = summary.provider && summary.model
    ? { name: summary.provider, model: summary.model, providerConfig: summary.provider ? memoryConfig.facts.maintenance.providerConfig : undefined }
    : undefined;

  const recallProvider = facts.recall.provider && facts.recall.model
    ? { name: facts.recall.provider, model: facts.recall.model, providerConfig: facts.recall.providerConfig }
    : undefined;

  const longTermMemoryService = facts.enabled
    ? new LongTermMemoryService(
        sessionManager as any,
        longTermMemoryStore as any,
        {
          enabled: facts.enabled,
          model: facts.maintenance.model,
          retrievalProvider: facts.recall.provider,
          retrievalModel: facts.recall.model,
          retrievalThreshold: facts.recall.threshold,
          retrievalTopK: facts.recall.topK
        },
        maintenanceProvider ? createOptionalProvider(maintenanceProvider, '长期记忆') : undefined,
        recallProvider ? createEmbeddingsClient(recallProvider) : undefined
      )
    : undefined;

  return new SessionMemoryService(
    sessionManager as any,
    summary.enabled && summary.provider && summary.model
      ? createOptionalProvider(maintenanceProvider, '记忆摘要')
      : undefined,
    summaryRuntimeConfig,
    longTermMemoryService
  );
}
