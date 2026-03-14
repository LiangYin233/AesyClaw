import { join } from 'path';
import type { Config } from '../../types.js';
import { logging, tokenUsage } from '../../observability/index.js';
import { parseConfig } from '../../config/index.js';

export function bootstrapRuntimeConfig(config: Config): Config {
  const resolved = parseConfig(config);
  logging.configure({
    level: resolved.observability.logging.level,
    bufferSize: resolved.observability.logging.bufferSize
  });
  tokenUsage.configure({
    enabled: resolved.observability.usage.enabled,
    persistFile: join(process.cwd(), resolved.observability.usage.persistFile),
    flushIntervalMs: resolved.observability.usage.flushIntervalMs
  });
  return resolved;
}
