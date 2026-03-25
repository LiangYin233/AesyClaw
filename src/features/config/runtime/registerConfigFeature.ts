import type { Express } from 'express';
import type { Config } from '../../../types.js';
import { registerConfigController } from '../api/config.controller.js';
import { ConfigService } from '../application/ConfigService.js';

export interface ConfigFeatureDeps {
  app: Express;
  log: {
    info(message: string, ...args: any[]): void;
  };
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
}

export function registerConfigFeature(deps: ConfigFeatureDeps): void {
  registerConfigController(
    deps.app,
    new ConfigService(),
    deps.log
  );
}
