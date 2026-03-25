import { CronApiService } from './CronApiService.js';
import { CronRepository } from './CronRepository.js';
import { registerCronController } from './cron.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerCronFeature(deps: ApiFeatureControllerDeps): void {
  if (!deps.cronService) {
    return;
  }

  registerCronController(
    deps.app,
    new CronApiService(new CronRepository(deps.cronService))
  );
}
