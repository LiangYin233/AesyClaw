import { z } from 'zod';
import { HTTP_URL_PROTOCOL } from './shared.js';

export const providerTypeSchema = z.enum(['openai', 'openai_responses', 'anthropic']);

export const providerApiBaseSchema = z.union([
  z.literal(''),
  z.url({ protocol: HTTP_URL_PROTOCOL })
]);

const providerModelConfigSchema = z.object({
  maxContextTokens: z.number().int().positive().optional(),
  reasoning: z.boolean().default(false),
  supportsVision: z.boolean().default(false)
}).strict().prefault(() => ({}));

const providerBaseSchema = z.object({
  type: providerTypeSchema,
  apiKey: z.string().optional(),
  apiBase: providerApiBaseSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  extraBody: z.record(z.string(), z.unknown()).optional()
});

const PROVIDER_RESERVED_KEYS = new Set(['type', 'apiKey', 'apiBase', 'headers', 'extraBody']);

export const providerConfigSchema = providerBaseSchema.catchall(providerModelConfigSchema).transform((value) => {
  const modelsFromFlatEntries = Object.fromEntries(
    Object.entries(value).filter(([key]) => !PROVIDER_RESERVED_KEYS.has(key))
  );

  return {
    type: value.type,
    apiKey: value.apiKey,
    apiBase: value.apiBase,
    headers: value.headers,
    extraBody: value.extraBody,
    models: modelsFromFlatEntries
  };
});

export type ProviderConfig = z.output<typeof providerConfigSchema>;
export type ProviderModelConfig = z.output<typeof providerModelConfigSchema>;
export const providerReservedKeys = [...PROVIDER_RESERVED_KEYS];

export function isEmbeddingCapableProvider(provider?: Pick<ProviderConfig, 'type'> | null): boolean {
  return provider?.type === 'openai';
}

export function listEmbeddingProviderNames(providers: Record<string, ProviderConfig>): string[] {
  return Object.entries(providers)
    .filter(([, provider]) => isEmbeddingCapableProvider(provider))
    .map(([name]) => name);
}

export function getProviderModelConfig(provider?: ProviderConfig, modelName?: string): ProviderModelConfig | undefined {
  if (!provider || !modelName) {
    return undefined;
  }

  const models = (provider.models || {}) as Record<string, ProviderModelConfig>;
  return models[modelName];
}

export function createDefaultProviders(): Record<string, ProviderConfig> {
  return {};
}
