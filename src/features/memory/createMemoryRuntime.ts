import { LongTermMemoryService } from '../../agent/infrastructure/memory/LongTermMemoryService.js';
import { OpenAIEmbeddingsClient } from '../../agent/infrastructure/memory/OpenAIEmbeddingsClient.js';
import { SessionMemoryService } from '../../agent/infrastructure/memory/SessionMemoryService.js';
import {
  getMemoryConfig,
  listEmbeddingProviderNames,
  resolveProviderSelection
} from '../../features/config/index.js';
import type { ResolvedProviderSelection } from '../../features/config/schema.js';
import { logger } from '../../platform/observability/index.js';
import { createProvider } from '../../platform/providers/index.js';
import { LongTermMemoryStore, SessionManager } from '../sessions/index.js';
import type { Config } from '../../types.js';

const appLog = logger.child('AesyClaw');

function createOptionalProvider(resolved: ResolvedProviderSelection, label: string) {
  if (!resolved.providerConfig) {
    appLog.warn(`配置中未找到${label}提供商 "${resolved.name}"`);
    return undefined;
  }

  return createProvider(resolved.name, resolved.providerConfig);
}

function createEmbeddingsClient(resolved: ResolvedProviderSelection | undefined): OpenAIEmbeddingsClient | undefined {
  if (!resolved?.providerConfig) {
    if (resolved?.name) {
      appLog.warn('未找到 embeddings 提供商', { provider: resolved.name });
    }
    return undefined;
  }

  if (!listEmbeddingProviderNames({ [resolved.name]: resolved.providerConfig }).length) {
    appLog.warn('embeddings 提供商必须为 openai 类型', {
      provider: resolved.name,
      type: resolved.providerConfig.type
    });
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
    appLog.warn('会话摘要已启用，但未完整配置 memorySummary.model；摘要压缩将被跳过');
  }

  const summaryRuntimeConfig = {
    enabled: summaryConfig.enabled,
    model: summaryConfig.model,
    compressRounds: summaryConfig.compressRounds,
    memoryWindow: sessionConfig.memoryWindow,
    contextMode: sessionConfig.contextMode
  };

  if (memoryConfig.facts.enabled && !memoryConfig.facts.maintenance.enabled) {
    appLog.warn('长期记忆已启用，但未完整配置 memoryFacts.model；后台自治维护将被跳过');
  }

  if (
    memoryConfig.facts.enabled
    && !memoryConfig.facts.recall.enabled
    && config.agent.defaults.memoryFacts.retrievalModel
  ) {
    appLog.warn('长期记忆自动召回需要配置合法的 memoryFacts.retrievalModel；当前将保持禁用');
  }

  const longTermMemoryService = memoryConfig.facts.enabled
    ? new LongTermMemoryService(
        sessionManager,
        longTermMemoryStore,
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
    sessionManager,
    summaryConfig.enabled && summaryConfig.provider && summaryConfig.model
      ? createOptionalProvider(resolveProviderSelection(config, `${summaryConfig.provider}/${summaryConfig.model}`), '记忆摘要')
      : undefined,
    summaryRuntimeConfig,
    longTermMemoryService
  );
}
