import { join } from 'path';
import type { Config } from '../../types.js';
import { logging, tokenUsage } from '../../observability/index.js';
import { parseConfig } from '../../config/index.js';

export function bootstrapRuntimeConfig(config: Config): Config {
  const resolved = parseConfig(config);
  logging.configure({
    level: resolved.observability.level
  });
  tokenUsage.configure({
    enabled: true,
    persistFile: join(process.cwd(), '.aesyclaw', 'token-usage.db')
  });
  return resolved;
}
