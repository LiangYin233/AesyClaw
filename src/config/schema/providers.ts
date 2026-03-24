import { z } from 'zod';
import {
  DEFAULT_PROVIDER_API_BASE,
  DEFAULT_PROVIDER_NAME,
  DEFAULT_PROVIDER_TYPE,
  HTTP_URL_PROTOCOL
} from './shared.js';

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
  extraBody: z.record(z.string(), z.unknown()).optional(),
  models: z.record(z.string(), providerModelConfigSchema).optional()
});

const PROVIDER_RESERVED_KEYS = new Set(['type', 'apiKey', 'apiBase', 'headers', 'extraBody', 'models']);

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
    models: {
      ...(value.models || {}),
      ...modelsFromFlatEntries
    }
  };
});

export type ProviderConfig = z.output<typeof providerConfigSchema>;
export type ProviderModelConfig = z.output<typeof providerModelConfigSchema>;
export const providerReservedKeys = [...PROVIDER_RESERVED_KEYS];

export function getProviderModelConfig(provider?: ProviderConfig, modelName?: string): ProviderModelConfig | undefined {
  if (!provider || !modelName) {
    return undefined;
  }

  const models = (provider.models || {}) as Record<string, ProviderModelConfig>;
  return models[modelName];
}

export function createDefaultProviders(): Record<string, ProviderConfig> {
  return {
    [DEFAULT_PROVIDER_NAME]: {
      type: DEFAULT_PROVIDER_TYPE,
      apiKey: '',
      apiBase: DEFAULT_PROVIDER_API_BASE,
      headers: undefined,
      extraBody: undefined,
      models: {
        'gpt-4o': {
          reasoning: false,
          supportsVision: true
        }
      }
    }
  };
}
