import { ObservabilityApiService } from './ObservabilityApiService.js';
import { registerObservabilityController } from './observability.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerObservabilityFeature(deps: ApiFeatureControllerDeps): void {
  registerObservabilityController(
    deps.app,
    new ObservabilityApiService(deps.updateConfig)
  );
}
