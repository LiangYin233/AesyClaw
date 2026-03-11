import { join } from 'path';
import type { Config } from '../../types.js';
import { logger } from '../../logger/index.js';
import { metrics } from '../../logger/Metrics.js';
import { tokenStats } from '../../logger/TokenStats.js';
import { normalizeConfig } from '../../config/loader.js';

export function bootstrapRuntimeConfig(config: Config): Config {
  const normalized = normalizeConfig(config);
  logger.setLevel(normalized.log?.level || 'info');
  if (normalized.metrics?.enabled !== undefined) {
    metrics.setEnabled(normalized.metrics.enabled);
  }
  tokenStats.setDataDir(join(process.cwd(), '.aesyclaw'));
  return normalized;
}
