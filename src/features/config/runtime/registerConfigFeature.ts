import type { Express } from 'express';
import { registerConfigController } from '../api/config.controller.js';
import { defaultConfigService } from '../index.js';

export interface ConfigFeatureDeps {
  app: Express;
  log: {
    info(message: string, ...args: any[]): void;
  };
}

export function registerConfigFeature(deps: ConfigFeatureDeps): void {
  registerConfigController(
    deps.app,
    defaultConfigService,
    deps.log
  );
}
