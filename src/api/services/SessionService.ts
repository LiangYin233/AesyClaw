import { NotFoundError } from '../../logger/index.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { AgentRoleService as RuntimeAgentRoleService } from '../../agent/roles/AgentRoleService.js';

export class SessionService {
  constructor(
    private sessionManager: SessionManager,
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
      agentName: session.agentName || await this.sessionManager.getSessionAgent(session.key) || this.getDefaultRoleName(),
      messageCount: session.messages.length
    })));
  }

  async getSessionDetails(key: string) {
    const session = await this.sessionManager.getOrCreate(key);
    return {
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid,
      agentName: session.agentName || await this.sessionManager.getSessionAgent(session.key) || this.getDefaultRoleName(),
      messageCount: session.messages.length,
      messages: session.messages
    };
  }

  async setSessionAgent(key: string, agentName: string | null): Promise<{ success: true; agentName: string }> {
    if (!this.agentRoleService) {
      throw new Error('Agent role service unavailable');
    }

    if (agentName === null || agentName === '') {
      await this.sessionManager.clearSessionAgent(key);
      return { success: true, agentName: this.getDefaultRoleName() };
    }

    const role = this.agentRoleService.getResolvedRole(agentName);
    if (!role) {
      throw new NotFoundError('Agent role', agentName);
    }

    await this.sessionManager.setSessionAgent(key, role.name);
    return { success: true, agentName: role.name };
  }

  async deleteSession(key: string): Promise<{ success: true }> {
    await this.sessionManager.delete(key);
    return { success: true };
  }
}
