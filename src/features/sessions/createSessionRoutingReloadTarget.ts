import { getSessionRuntimeConfig } from '../../config/index.js';
import type { ConfigReloadTargets } from '../../config/reload/ports/ReloadTargets.js';
import type { Services } from '../../bootstrap/factory/ServiceFactory.js';

export function createSessionRoutingReloadTarget(services: Services): NonNullable<ConfigReloadTargets['sessionRouting']> {
  return {
    applyConfig(config) {
      services.sessionRouting.setContextMode(getSessionRuntimeConfig(config).contextMode);
    }
  };
}
