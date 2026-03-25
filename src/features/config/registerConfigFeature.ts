import { ConfigApiService } from './ConfigApiService.js';
import { ConfigRepository } from './ConfigRepository.js';
import { registerConfigController } from './config.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerConfigFeature(deps: ApiFeatureControllerDeps): void {
  registerConfigController(
    deps.app,
    new ConfigApiService(new ConfigRepository(deps.getConfig, deps.updateConfig)),
    deps.log
  );
}
