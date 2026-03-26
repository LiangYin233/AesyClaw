import { registerAgentsController } from '../api/agents.controller.js';
import { AgentsService } from '../application/AgentsService.js';
import { AgentRepository } from '../infrastructure/AgentRepository.js';
import type { ApiFeatureControllerDeps } from '../../featureDeps.js';

export function registerAgentsFeature(deps: ApiFeatureControllerDeps): void {
  registerAgentsController(
    deps.app,
    new AgentsService(new AgentRepository(deps.sessionRouting, deps.agentRoleService))
  );
}
