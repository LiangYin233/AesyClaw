import type { InboundMessage } from '../../types.js';

export interface SessionReference {
  sessionKey?: string;
  channel?: string;
  chatId?: string;
  messageType?: 'private' | 'group';
}

export function deriveSessionReference(reference: string): SessionReference {
  const parts = reference.split(':');
  const channel = parts[0]?.trim();
  const chatId = parts[1]?.trim();

  return {
    sessionKey: reference,
    ...(channel ? { channel } : {}),
    ...(chatId ? { chatId } : {})
  };
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

export interface SessionRoute {
  sessionKey: string;
  channelChatKey: string;
}

export interface ISessionRouting {
  resolve(msg: Pick<InboundMessage, 'channel' | 'chatId'> & { sessionKey?: string }): Promise<SessionRoute>;
  createNewSession(channel: string, chatId: string): string;
  switchSession(channel: string, chatId: string, sessionKey: string): void;
  getActiveSession(channel: string, chatId: string): string | undefined;
  resolveByChannel(channel: string, chatId: string): string | undefined;
  getContextMode(): string;
  setContextMode(contextMode: string): void;
  getConversationAgent(channel: string, chatId: string): string | undefined;
  setConversationAgent(channel: string, chatId: string, agentName: string): void;
  clearConversationAgent(channel: string, chatId: string): void;
  deleteAgentBindings(agentName: string): number;
  deleteSessionBinding(sessionKey: string, channel: string, chatId: string): void;
}

export interface SessionRoutingFactory {
  create(sessionManager: unknown, contextMode?: string): ISessionRouting;
}
