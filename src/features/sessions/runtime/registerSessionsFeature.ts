import type { Express } from 'express';
import type { AgentRoleService } from '../../../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../../../agent/infrastructure/session/SessionRoutingService.js';
import type { SessionManager } from '../application/SessionManager.js';
import { registerSessionsController } from '../api/sessions.controller.js';
import { SessionService } from '../application/SessionService.js';
import { ConversationAgentGateway } from '../infrastructure/ConversationAgentGateway.js';
import { SessionsRepository } from '../infrastructure/SessionsRepository.js';

export interface SessionsFeatureDeps {
  app: Express;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  agentRoleService?: AgentRoleService;
}

export function registerSessionsFeature(deps: SessionsFeatureDeps): void {
  const sessionsRepository = new SessionsRepository(deps.sessionManager);
  const conversationAgentGateway = new ConversationAgentGateway(
    deps.sessionRouting,
    deps.agentRoleService
  );

  registerSessionsController(
    deps.app,
    new SessionService(sessionsRepository, conversationAgentGateway, deps.sessionRouting)
  );
}
