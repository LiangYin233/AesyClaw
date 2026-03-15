import { NotFoundError } from '../../errors/index.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { AgentRoleService as RuntimeAgentRoleService } from '../../agent/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../../agent/session/SessionRoutingService.js';

export class SessionService {
  constructor(
    private sessionManager: SessionManager,
    private sessionRouting: SessionRoutingService,
    private agentRoleService?: RuntimeAgentRoleService
  ) {}

  private getDefaultRoleName(): string {
    return this.agentRoleService?.getDefaultRoleName() || 'main';
  }

  async listSessions() {
    const sessions = this.sessionManager.list();
    return Promise.all(sessions.map(async (session) => ({
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid,
      agentName: this.sessionRouting.getConversationAgent(session.channel, session.chatId) || this.getDefaultRoleName(),
      messageCount: session.messages.length
    })));
  }

  async getSessionDetails(key: string) {
    const session = await this.sessionManager.getExistingOrThrow(key);
    return {
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid,
      agentName: this.sessionRouting.getConversationAgent(session.channel, session.chatId) || this.getDefaultRoleName(),
      messageCount: session.messages.length,
      messages: session.messages
    };
  }

  async setSessionAgent(key: string, agentName: string | null): Promise<{ success: true; agentName: string }> {
    if (!this.agentRoleService) {
      throw new Error('Agent role service unavailable');
    }

    if (agentName === null || agentName === '') {
      const session = await this.sessionManager.getExistingOrThrow(key);
      this.sessionRouting.clearConversationAgent(session.channel, session.chatId);
      return { success: true, agentName: this.getDefaultRoleName() };
    }

    const role = this.agentRoleService.getResolvedRole(agentName);
    if (!role) {
      throw new NotFoundError('Agent role', agentName);
    }

    const session = await this.sessionManager.getExistingOrThrow(key);
    this.sessionRouting.setConversationAgent(session.channel, session.chatId, role.name);
    return { success: true, agentName: role.name };
  }

  async deleteSession(key: string): Promise<{ success: true }> {
    await this.sessionManager.delete(key);
    return { success: true };
  }
}
