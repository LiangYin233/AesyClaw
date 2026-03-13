import type { ContextMode } from '../types.js';
import type { InboundMessage } from '../../types.js';
import type { SessionManager } from '../../session/SessionManager.js';

export interface SessionRoute {
  sessionKey: string;
  channelChatKey: string;
}

export class SessionRoutingService {
  private channelSessions: Map<string, string> = new Map();

  constructor(
    private sessionManager: SessionManager,
    private contextMode: ContextMode = 'channel'
  ) {}

  resolve(msg: Pick<InboundMessage, 'channel' | 'chatId'> & { sessionKey?: string }): SessionRoute {
    const channelChatKey = `${msg.channel}:${msg.chatId}`;
    const sessionKey = msg.sessionKey || this.resolveSessionKey(msg.channel, msg.chatId, channelChatKey);

    if (this.contextMode === 'channel') {
      this.channelSessions.set(channelChatKey, sessionKey);
    }

    return { sessionKey, channelChatKey };
  }

  assignToMessage<T extends Pick<InboundMessage, 'channel' | 'chatId'> & { sessionKey?: string }>(msg: T): T {
    const { sessionKey } = this.resolve(msg);
    msg.sessionKey = sessionKey;
    return msg;
  }

  createNewSession(channel: string, chatId: string): string {
    const sessionKey = this.sessionManager.createNewSession(channel, chatId);
    if (this.contextMode === 'channel') {
      this.channelSessions.set(`${channel}:${chatId}`, sessionKey);
    }
    return sessionKey;
  }

  switchSession(channel: string, chatId: string, sessionKey: string): void {
    if (this.contextMode === 'channel') {
      this.channelSessions.set(`${channel}:${chatId}`, sessionKey);
    }
  }

  getActiveSession(channel: string, chatId: string): string | undefined {
    if (this.contextMode === 'global') {
      return 'global';
    }
    if (this.contextMode === 'channel') {
      return this.channelSessions.get(`${channel}:${chatId}`);
    }
    return undefined;
  }

  resolveByChannel(channel: string, chatId: string): string | undefined {
    return this.getActiveSession(channel, chatId);
  }

  private resolveSessionKey(channel: string, chatId: string, channelChatKey: string): string {
    if (this.contextMode === 'channel') {
      return this.channelSessions.get(channelChatKey) || this.createNewSession(channel, chatId);
    }

    if (this.contextMode === 'global') {
      return 'global';
    }

    return this.sessionManager.createNewSession(channel, chatId);
  }
}
