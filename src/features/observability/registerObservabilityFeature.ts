import { ObservabilityApiService } from './ObservabilityApiService.js';
import { ObservabilityRepository } from './ObservabilityRepository.js';
import { registerObservabilityController } from './observability.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerObservabilityFeature(deps: ApiFeatureControllerDeps): void {
  registerObservabilityController(
    deps.app,
    new ObservabilityApiService(new ObservabilityRepository(deps.updateConfig))
  );
}
