import type { ISessionRouting } from '../../../platform/context/index.js';
import type { AgentRoleService } from '../../../platform/context/AgentContext.js';

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
