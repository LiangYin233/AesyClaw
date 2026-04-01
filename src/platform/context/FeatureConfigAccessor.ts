import type { Config } from '../../types.js';
import type { ResolvedProviderSelection } from '../../features/config/schema/index.js';
import { MAIN_AGENT_NAME } from '../../features/config/schema/shared.js';

export function getMainAgentConfig(config: Config) {
  const mainAgent = config.agents.roles[MAIN_AGENT_NAME];
  const defaults = config.agent.defaults;
  const provider = resolveProviderSelection(config, mainAgent?.model || '');
  return {
    role: {
      name: mainAgent?.name ?? MAIN_AGENT_NAME,
      description: mainAgent?.description ?? '',
      systemPrompt: mainAgent?.systemPrompt ?? '',
      model: mainAgent?.model ?? '',
      allowedSkills: mainAgent?.allowedSkills ?? [],
      allowedTools: mainAgent?.allowedTools ?? []
    },
    provider,
    maxIterations: defaults.maxToolIterations,
    memoryWindow: defaults.memoryWindow,
    visionSettings: {
      enabled: !!defaults.visionFallbackModel,
      directVision: provider.modelConfig?.supportsVision ?? false,
      reasoning: provider.modelConfig?.reasoning ?? false,
      fallbackModelRef: defaults.visionFallbackModel || undefined
    }
  };
}

export function getMemoryConfig(config: Config) {
  const defaults = config.agent.defaults;
  const memorySummary = defaults.memorySummary;
  const memoryFacts = defaults.memoryFacts;
  const summaryModel = memorySummary?.model ?? '';
  const summaryParts = summaryModel.split('/');
  const factsModel = memoryFacts?.model ?? '';
  const factsParts = factsModel.split('/');
  const recallModel = memoryFacts?.retrievalModel ?? '';
  const recallParts = recallModel.split('/');
  return {
    session: {
      memoryWindow: defaults.memoryWindow,
      contextMode: defaults.contextMode
    },
    summary: {
      enabled: memorySummary?.enabled ?? false,
      provider: summaryParts[0] || undefined,
      model: summaryParts[1] || undefined,
      compressRounds: memorySummary?.compressRounds ?? 5
    },
    facts: {
      enabled: memoryFacts?.enabled ?? false,
      maintenance: {
        provider: factsParts[0] || undefined,
        model: factsParts[1] || undefined
      },
      recall: {
        provider: recallParts[0] || undefined,
        model: recallParts[1] || undefined,
        threshold: memoryFacts?.retrievalThreshold ?? 0.7,
        topK: memoryFacts?.retrievalTopK ?? 5
      }
    }
  };
}

export function getObservabilityConfig(config: Config) {
  return {
    level: config.observability?.level ?? 'info',
    bufferSize: config.observability?.bufferSize ?? 100,
    pretty: config.observability?.pretty ?? false
  };
}

export function getToolRuntimeConfig(config: Config) {
  return {
    timeoutMs: config.tools?.timeoutMs ?? 120000
  };
}

export function resolveProviderSelection(config: Config, providerModel: string): ResolvedProviderSelection {
  const [provider, model] = providerModel.split('/');
  const providerConfig = config.providers?.[provider];

  if (!providerConfig) {
    return { name: provider, providerConfig: undefined, model };
  }

  return {
    name: provider,
    providerConfig,
    model: model || ''
  };
}

export function listEmbeddingProviderNames(providers: Record<string, unknown>): string[] {
  return Object.entries(providers)
    .filter(([_, config]) => {
      const c = config as { supportsEmbeddings?: boolean };
      return c.supportsEmbeddings === true;
    })
    .map(([name]) => name);
}
