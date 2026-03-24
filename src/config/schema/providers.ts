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
  maxContextTokens: z.number().int().positive()
});

export const providerConfigSchema = z.object({
  type: providerTypeSchema,
  apiKey: z.string().optional(),
  apiBase: providerApiBaseSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  extraBody: z.record(z.string(), z.unknown()).optional(),
  models: z.record(z.string(), providerModelConfigSchema).optional()
});

export type ProviderConfig = z.output<typeof providerConfigSchema>;

export function createDefaultProviders(): Record<string, ProviderConfig> {
  return {
    [DEFAULT_PROVIDER_NAME]: {
      type: DEFAULT_PROVIDER_TYPE,
      apiKey: '',
      apiBase: DEFAULT_PROVIDER_API_BASE
    }
  };
}
