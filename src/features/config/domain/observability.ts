import type { ObservabilityConfig } from '../schema/index.js';
import { readConfig, type ConfigSource } from './shared.js';

export function getObservabilityConfig(source: ConfigSource): ObservabilityConfig {
  return readConfig(source).observability;
}
