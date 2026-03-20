import type { ToolContext } from '../../../tools/ToolRegistry.js';
import type { InboundMessage } from '../../../types.js';
import type { AgentTurnContext } from '../../application/inbound/handleInboundMessage.js';

export interface SessionHistoryMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: Date;
}

export interface ResolvedSessionContext extends AgentTurnContext {
  request: InboundMessage;
  agentName: string;
  history: SessionHistoryMessage[];
}

export interface SessionResolverOptions {
  toolContext: ToolContext;
  suppressOutbound?: boolean;
  memoryWindow: number;
}

export interface SessionResolverDeps {
  resolveSessionKey: (message: InboundMessage) => string;
  getHistory: (
    sessionKey: string,
    message: InboundMessage,
    memoryWindow: number
  ) => Promise<SessionHistoryMessage[]>;
  getAgentName?: (message: InboundMessage) => string | undefined;
}

export class SessionResolver {
  constructor(private readonly deps: SessionResolverDeps) {}

  async resolve(message: InboundMessage, options: SessionResolverOptions): Promise<ResolvedSessionContext> {
    const sessionKey = message.sessionKey || this.deps.resolveSessionKey(message);
    message.sessionKey = sessionKey;

    return {
      request: message,
      sessionKey,
      channel: message.channel,
      chatId: message.chatId,
      messageType: message.messageType,
      agentName: this.deps.getAgentName?.(message) || 'main',
      history: await this.deps.getHistory(sessionKey, message, options.memoryWindow),
      suppressOutbound: options.suppressOutbound === true,
      toolContext: {
        ...options.toolContext,
        sessionKey,
        channel: message.channel,
        chatId: message.chatId,
        messageType: message.messageType
      }
    };
  }
}
