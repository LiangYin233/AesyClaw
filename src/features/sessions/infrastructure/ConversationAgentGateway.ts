import type { ISessionRouting } from '../../../agent/domain/session.js';
import type { AgentRoleService } from '../../../agent/infrastructure/roles/AgentRoleService.js';

export class ConversationAgentGateway {
  constructor(
    private readonly sessionRouting: ISessionRouting,
    private readonly agentRoleService?: AgentRoleService
  ) {}

  resolveConversationAgent(channel: string, chatId: string): string {
    return this.sessionRouting.getConversationAgent(channel, chatId)
      || this.agentRoleService?.getDefaultRoleName()
      || 'main';
  }
}
