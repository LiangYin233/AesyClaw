import { registerSystemController } from '../api/system.controller.js';
import { SystemService } from '../application/SystemService.js';
import type { ApiFeatureControllerDeps } from '../../featureDeps.js';

export function registerSystemFeature(deps: ApiFeatureControllerDeps): void {
  registerSystemController(
    deps.app,
    new SystemService(
      deps.packageVersion,
      deps.agentRuntime,
      deps.sessionManager,
      deps.channelManager,
      deps.getConfig,
      deps.toolRegistry
    )
  );
}
