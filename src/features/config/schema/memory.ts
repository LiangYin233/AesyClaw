import { z } from 'zod';

export const memorySummaryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  model: z.string().default(''),
  compressRounds: z.number().int().finite().min(1).default(5)
}).strict().prefault(() => ({}));

export const memoryFactsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  model: z.string().default(''),
  retrievalModel: z.string().default(''),
  retrievalThreshold: z.number().finite().min(0).max(1).default(0.59),
  retrievalTopK: z.number().int().finite().min(1).max(20).default(5)
}).strict().prefault(() => ({}));

export type MemorySummaryConfig = z.output<typeof memorySummaryConfigSchema>;
export type MemoryFactsConfig = z.output<typeof memoryFactsConfigSchema>;
