import { getObservabilityConfig } from '../../features/config/index.js';
import { logging } from '../../platform/observability/index.js';
import type { ConfigReloadTargets } from '../../features/config/reload/ports/ReloadTargets.js';

export function createObservabilityReloadTarget(): NonNullable<ConfigReloadTargets['observability']> {
  return {
    applyConfig(config) {
      logging.configure({
        level: getObservabilityConfig(config).level
      });
    }
  };
}
