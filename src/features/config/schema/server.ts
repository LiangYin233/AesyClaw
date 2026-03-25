import { z } from 'zod';
import { withObjectInputDefault } from './shared.js';

export const serverConfigSchema = withObjectInputDefault({
  host: z.string().default('0.0.0.0'),
  apiPort: z.number().int().finite().default(18792),
  apiEnabled: z.boolean().default(true),
  token: z.string().default('')
});

export type ServerConfig = z.output<typeof serverConfigSchema>;
