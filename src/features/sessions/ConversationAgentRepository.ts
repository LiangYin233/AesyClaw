import type { AgentRoleService } from '../../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../../agent/infrastructure/session/SessionRoutingService.js';

export class ConversationAgentRepository {
  constructor(
    private readonly sessionRouting: SessionRoutingService,
    private readonly agentRoleService?: AgentRoleService
  ) {}

  resolveConversationAgent(channel: string, chatId: string): string {
    return this.sessionRouting.getConversationAgent(channel, chatId)
      || this.agentRoleService?.getDefaultRoleName()
      || 'main';
  }
}
