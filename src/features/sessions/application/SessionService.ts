import { SessionNotFoundError, SessionValidationError } from '../domain/types.js';
import { DomainValidationError, ResourceNotFoundError } from '../../../platform/errors/domain.js';
import { ConversationAgentGateway } from '../infrastructure/ConversationAgentGateway.js';
import { SessionsRepository } from '../infrastructure/SessionsRepository.js';
import type { ISessionRouting } from '../../../agent/domain/session.js';

type SessionListItem = {
  key: string;
  channel: string;
  chatId: string;
  uuid: string | null;
  agentName: string;
  messageCount: number;
  updatedAt: string;
};

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareSessions(left: SessionListItem, right: SessionListItem): number {
  const updatedAtDiff = toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt);
  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }

  const messageCountDiff = right.messageCount - left.messageCount;
  if (messageCountDiff !== 0) {
    return messageCountDiff;
  }

  return left.key.localeCompare(right.key);
}

export class SessionService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly conversationAgentGateway: ConversationAgentGateway,
    private readonly sessionRouting: ISessionRouting
  ) {}

  async listSessions(): Promise<SessionListItem[]> {
    const sessions = this.sessionsRepository.list();
    const items = await Promise.all(sessions.map(async (session) => ({
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid ?? null,
      agentName: this.conversationAgentGateway.resolveConversationAgent(session.channel, session.chatId),
      messageCount: session.messages.length,
      updatedAt: session.updatedAt.toISOString()
    })));
    return items.sort(compareSessions);
  }

  async getSessionDetails(key: string): Promise<{
    key: string;
    channel: string;
    chatId: string;
    uuid: string | null;
    agentName: string;
    messageCount: number;
    updatedAt: string;
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
        updatedAt: session.updatedAt.toISOString(),
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
      const session = await this.sessionsRepository.getByKeyOrThrow(key);
      await this.sessionsRepository.deleteByKey(key);
      this.sessionRouting.deleteSessionBinding(session.key, session.channel, session.chatId);
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
