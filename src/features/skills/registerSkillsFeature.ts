import { SkillApiService } from './SkillApiService.js';
import { SkillRepository } from './SkillRepository.js';
import { registerSkillsController } from './skills.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerSkillsFeature(deps: ApiFeatureControllerDeps): void {
  if (!deps.skillManager) {
    return;
  }

  registerSkillsController(
    deps.app,
    new SkillApiService(new SkillRepository(deps.skillManager))
  );
}
