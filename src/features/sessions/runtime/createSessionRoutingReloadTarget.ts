import type { Services } from '../../../app/bootstrap/factory/ServiceFactory.js';
import type { Config } from '../../../types.js';

interface SessionRoutingReloadHandler {
  applyConfig(config: Config): void;
}

export function createSessionRoutingReloadTarget(services: Services): SessionRoutingReloadHandler {
  return {
    applyConfig(config) {
      services.sessionRouting.setContextMode(config.agent.defaults.contextMode);
    }
  };
}
