import { SessionNotFoundError, SessionValidationError } from '../../session/errors.js';
import { NotFoundError, ValidationError } from '../../api/errors.js';
import { ConversationAgentRepository } from './ConversationAgentRepository.js';
import { SessionsRepository } from './SessionsRepository.js';

export class SessionApiService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly conversationAgentRepository: ConversationAgentRepository
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
      agentName: this.conversationAgentRepository.resolveConversationAgent(session.channel, session.chatId),
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
        agentName: this.conversationAgentRepository.resolveConversationAgent(session.channel, session.chatId),
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
      await this.sessionsRepository.deleteByKey(key);
      return { success: true };
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        throw new NotFoundError('Session', key);
      }
      throw error;
    }
  }

  private validateSessionKey(key: string): void {
    try {
      this.sessionsRepository.validateKey(key);
    } catch (error) {
      if (error instanceof SessionValidationError) {
        throw new ValidationError(error.message, 'key', error.details);
      }
      throw error;
    }
  }
}
