import { getObservabilityConfig } from '../../config/index.js';
import { logging } from '../../../platform/observability/index.js';
import type { ConfigReloadTargets } from '../../config/reload/ports/ReloadTargets.js';

export function createObservabilityReloadTarget(): NonNullable<ConfigReloadTargets['observability']> {
  return {
    applyConfig(config) {
      logging.configure({
        level: getObservabilityConfig(config).level,
        bufferSize: getObservabilityConfig(config).bufferSize,
        pretty: getObservabilityConfig(config).pretty
      });
    }
  };
}
