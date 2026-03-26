import { SkillApiService } from './SkillApiService.js';
import { registerSkillsController } from './skills.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerSkillsFeature(deps: ApiFeatureControllerDeps): void {
  if (!deps.skillManager) {
    return;
  }

  registerSkillsController(
    deps.app,
    new SkillApiService(deps.skillManager)
  );
}
