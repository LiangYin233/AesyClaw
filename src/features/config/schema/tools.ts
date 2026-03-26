import { z } from 'zod';
import { withObjectInputDefault } from './shared.js';

export const toolsConfigSchema = withObjectInputDefault({
  timeoutMs: z.number().int().finite().default(120000)
});

export const observabilityConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  bufferSize: z.number().int().positive().finite().default(1000),
  pretty: z.boolean().default(true)
}).strict().prefault(() => ({}));

export type ToolsConfig = z.output<typeof toolsConfigSchema>;
export type LoggingConfig = z.output<typeof observabilityConfigSchema>;
export type ObservabilityConfig = z.output<typeof observabilityConfigSchema>;
