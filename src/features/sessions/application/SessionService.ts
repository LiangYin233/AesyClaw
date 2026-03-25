import { SessionNotFoundError, SessionValidationError } from '../domain/types.js';
import { DomainValidationError, ResourceNotFoundError } from '../../../platform/errors/domain.js';
import { ConversationAgentGateway } from '../infrastructure/ConversationAgentGateway.js';
import { SessionsRepository } from '../infrastructure/SessionsRepository.js';

export class SessionService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly conversationAgentGateway: ConversationAgentGateway
  ) {}

  async listSessions(): Promise<Array<{
    key: string;
    channel: string;
    chatId: string;
    uuid: string | null;
    agentName: string;
    messageCount: number;
  }>> {
    const sessions = this.sessionsRepository.list();
    return Promise.all(sessions.map(async (session) => ({
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid ?? null,
      agentName: this.conversationAgentGateway.resolveConversationAgent(session.channel, session.chatId),
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
      const session = await this.sessionsRepository.getByKeyOrThrow(key);
      return {
        key: session.key,
        channel: session.channel,
        chatId: session.chatId,
        uuid: session.uuid ?? null,
        agentName: this.conversationAgentGateway.resolveConversationAgent(session.channel, session.chatId),
        messageCount: session.messages.length,
        messages: session.messages
      };
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        throw new ResourceNotFoundError('Session', key);
      }
      throw error;
    }
  }

  async deleteSession(key: string): Promise<{ success: true }> {
    this.validateSessionKey(key);

    try {
      await this.sessionsRepository.deleteByKey(key);
      return { success: true };
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        throw new ResourceNotFoundError('Session', key);
      }
      throw error;
    }
  }

  private validateSessionKey(key: string): void {
    try {
      this.sessionsRepository.validateKey(key);
    } catch (error) {
      if (error instanceof SessionValidationError) {
        throw new DomainValidationError(error.message, 'key', error.details);
      }
      throw error;
    }
  }
}
