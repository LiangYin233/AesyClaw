import { join } from 'path';
import type { Config } from '../../types.js';
import { logger } from '../../logger/index.js';
import { metrics } from '../../logger/Metrics.js';
import { tokenStats } from '../../logger/TokenStats.js';
import { parseConfig } from '../../config/index.js';

export function bootstrapRuntimeConfig(config: Config): Config {
  const resolved = parseConfig(config);
  logger.setLevel(resolved.log.level);
  metrics.setEnabled(resolved.metrics.enabled);
  tokenStats.setDataDir(join(process.cwd(), '.aesyclaw'));
  return resolved;
}
