import { ConversationAgentRepository } from './ConversationAgentRepository.js';
import { SessionApiService } from './SessionApiService.js';
import { SessionsRepository } from './SessionsRepository.js';
import { registerSessionsController } from './sessions.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerSessionsFeature(deps: ApiFeatureControllerDeps): void {
  const sessionsRepository = new SessionsRepository(deps.sessionManager);
  const conversationAgentRepository = new ConversationAgentRepository(
    deps.sessionRouting,
    deps.agentRoleService
  );

  registerSessionsController(
    deps.app,
    new SessionApiService(sessionsRepository, conversationAgentRepository)
  );
}
