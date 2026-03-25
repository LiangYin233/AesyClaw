import type { Express } from 'express';
import type { CronRuntimeService } from '../index.js';
import { registerCronController } from '../api/cron.controller.js';
import { CronService } from '../application/CronService.js';
import { CronRepository } from '../infrastructure/CronRepository.js';

export interface CronFeatureDeps {
  app: Express;
  cronService?: CronRuntimeService;
}

export function registerCronFeature(deps: CronFeatureDeps): void {
  if (!deps.cronService) {
    return;
  }

  registerCronController(
    deps.app,
    new CronService(new CronRepository(deps.cronService))
  );
}
