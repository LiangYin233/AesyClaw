import { AgentApiService } from './AgentApiService.js';
import { AgentRepository } from './AgentRepository.js';
import { registerAgentsController } from './agents.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerAgentsFeature(deps: ApiFeatureControllerDeps): void {
  registerAgentsController(
    deps.app,
    new AgentApiService(new AgentRepository(deps.sessionRouting, deps.agentRoleService))
  );
}
