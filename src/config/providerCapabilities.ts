import type { ProviderConfig } from './schema/index.js';

export function isEmbeddingCapableProvider(provider?: Pick<ProviderConfig, 'type'> | null): boolean {
  return provider?.type === 'openai';
}

export function listEmbeddingProviderNames(providers: Record<string, ProviderConfig>): string[] {
  return Object.entries(providers)
    .filter(([, provider]) => isEmbeddingCapableProvider(provider))
    .map(([name]) => name);
}
