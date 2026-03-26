import { registerSkillsController } from '../api/skills.controller.js';
import { SkillsService } from '../application/SkillsService.js';
import type { ApiFeatureControllerDeps } from '../../featureDeps.js';

export function registerSkillsFeature(deps: ApiFeatureControllerDeps): void {
  if (!deps.skillManager) {
    return;
  }

  registerSkillsController(
    deps.app,
    new SkillsService(deps.skillManager)
  );
}
