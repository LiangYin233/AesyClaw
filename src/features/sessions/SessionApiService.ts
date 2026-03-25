import type { AgentRoleService } from '../../agent/infrastructure/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../../agent/infrastructure/session/SessionRoutingService.js';
import { SessionManager } from '../../session/SessionManager.js';
import { SessionNotFoundError, SessionValidationError } from '../../session/errors.js';
import { NotFoundError, ValidationError } from '../../api/errors.js';

export class SessionApiService {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly sessionRouting: SessionRoutingService,
    private readonly agentRoleService?: AgentRoleService
  ) {}

  async listSessions(): Promise<Array<{
    key: string;
    channel: string;
    chatId: string;
    uuid: string | null;
    agentName: string;
    messageCount: number;
  }>> {
    const sessions = this.sessionManager.list();
    return Promise.all(sessions.map(async (session) => ({
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid ?? null,
      agentName: this.resolveAgentName(session.channel, session.chatId),
      messageCount: session.messages.length
    })));
  }

  async getSessionDetails(key: string): Promise<{
    key: string;
    channel: string;
    chatId: string;
    uuid: string | null;
    agentName: string;
    messageCount: number;
    messages: unknown[];
  }> {
    this.validateSessionKey(key);

    try {
      const session = await this.sessionManager.getExistingOrThrow(key);
      return {
        key: session.key,
        channel: session.channel,
        chatId: session.chatId,
        uuid: session.uuid ?? null,
        agentName: this.resolveAgentName(session.channel, session.chatId),
        messageCount: session.messages.length,
        messages: session.messages
      };
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        throw new NotFoundError('Session', key);
      }
      throw error;
    }
  }

  async deleteSession(key: string): Promise<{ success: true }> {
    this.validateSessionKey(key);

    try {
      await this.sessionManager.delete(key);
      return { success: true };
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        throw new NotFoundError('Session', key);
      }
      throw error;
    }
  }

  private resolveAgentName(channel: string, chatId: string): string {
    return this.sessionRouting.getConversationAgent(channel, chatId)
      || this.agentRoleService?.getDefaultRoleName()
      || 'main';
  }

  private validateSessionKey(key: string): void {
    try {
      SessionManager.validateSessionKey(key);
    } catch (error) {
      if (error instanceof SessionValidationError) {
        throw new ValidationError(error.message, 'key', error.details);
      }
      throw error;
    }
  }
}
