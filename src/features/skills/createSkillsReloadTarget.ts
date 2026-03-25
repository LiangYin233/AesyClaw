import type { ConfigReloadTargets } from '../../config/reload/ports/ReloadTargets.js';
import type { Services } from '../../app/bootstrap/factory/ServiceFactory.js';

export function createSkillsReloadTarget(services: Services): NonNullable<ConfigReloadTargets['skills']> {
  return {
    applyConfig(config) {
      services.skillManager?.applyConfig(config);
    }
  };
}
