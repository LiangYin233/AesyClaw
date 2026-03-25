import { registerSystemController } from './system.controller.js';
import { SystemApiService } from './SystemApiService.js';
import { SystemRepository } from './SystemRepository.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerSystemFeature(deps: ApiFeatureControllerDeps): void {
  registerSystemController(
    deps.app,
    new SystemApiService(
      deps.packageVersion,
      new SystemRepository(
        deps.agentRuntime,
        deps.sessionManager,
        deps.channelManager,
        deps.getConfig,
        deps.toolRegistry
      )
    )
  );
}
