export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface ConversationMessage extends SessionMessage {
  id: number;
  sessionKey: string;
  sessionId: number;
}

export interface ConversationMemory {
  channel: string;
  chatId: string;
  summary: string;
  summarizedUntilMessageId: number;
  updatedAt?: string;
}

export interface Session {
  key: string;
  id?: number;
  channel: string;
  chatId: string;
  uuid?: string;
  summary: string;
  summarizedMessageCount: number;
  messages: SessionMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export function parseSessionKey(key: string): { channel: string; chatId: string; uuid?: string } {
  const parts = key.split(':');
  const channel = parts[0]?.trim();
  const chatId = parts[1]?.trim();

  if (!channel || !chatId) {
    throw new SessionValidationError('session key must use format "channel:chatId[:uuid]"', {
      field: 'key',
      key
    });
  }

  if (parts.length >= 3) {
    const uuid = parts.slice(2).join(':').trim();
    return { channel, chatId, ...(uuid ? { uuid } : {}) };
  }

  return { channel, chatId };
}

export class SessionValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SessionValidationError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionKey: string) {
    super(`Session with id "${sessionKey}" not found`);
    this.name = 'SessionNotFoundError';
  }
}

export { normalizeErrorMessage as normalizeSessionError } from '../../../platform/errors/index.js';
