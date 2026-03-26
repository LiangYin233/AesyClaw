import { registerObservabilityController } from '../api/observability.controller.js';
import { ObservabilityService } from '../application/ObservabilityService.js';
import type { ApiFeatureControllerDeps } from '../../featureDeps.js';

export function registerObservabilityFeature(deps: ApiFeatureControllerDeps): void {
  registerObservabilityController(
    deps.app,
    new ObservabilityService(deps.updateConfig)
  );
}
