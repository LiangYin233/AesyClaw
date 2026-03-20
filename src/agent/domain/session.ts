import type { InboundMessage } from '../../types.js';

export interface SessionReference {
  sessionKey?: string;
  channel?: string;
  chatId?: string;
  messageType?: 'private' | 'group';
}

export function bindSessionReference(
  message: InboundMessage,
  reference: SessionReference | string
): InboundMessage {
  if (typeof reference === 'string') {
    return {
      ...message,
      sessionKey: message.sessionKey || reference
    };
  }

  return {
    ...message,
    sessionKey: message.sessionKey || reference.sessionKey,
    channel: reference.channel || message.channel,
    chatId: reference.chatId || message.chatId,
    senderId: message.senderId || reference.chatId || message.chatId,
    messageType: reference.messageType || message.messageType
  };
}

export function mapSessionReference<T>(
  reference: SessionReference | string,
  handlers: {
    bySessionKey: (sessionKey: string) => T;
    byChannelChat?: (channel: string, chatId: string) => T;
  }
): T | undefined {
  if (typeof reference === 'string') {
    return handlers.bySessionKey(reference);
  }

  if (reference.sessionKey) {
    return handlers.bySessionKey(reference.sessionKey);
  }

  if (reference.channel && reference.chatId && handlers.byChannelChat) {
    return handlers.byChannelChat(reference.channel, reference.chatId);
  }

  return undefined;
}
