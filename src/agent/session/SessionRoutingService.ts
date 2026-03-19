import type { ContextMode } from '../types.js';
import type { InboundMessage } from '../../types.js';
import type { SessionManager } from '../../session/SessionManager.js';

export interface SessionRoute {
  sessionKey: string;
  channelChatKey: string;
}

export class SessionRoutingService {
  private channelSessions: Map<string, string> = new Map();
  private conversationAgents: Map<string, string> = new Map();

  constructor(
    private sessionManager: SessionManager,
    private contextMode: ContextMode = 'session'
  ) {}

  resolve(msg: Pick<InboundMessage, 'channel' | 'chatId'> & { sessionKey?: string }): SessionRoute {
    const channelChatKey = `${msg.channel}:${msg.chatId}`;
    const sessionKey = msg.sessionKey || this.resolveSessionKey(msg.channel, msg.chatId, channelChatKey);
    this.channelSessions.set(channelChatKey, sessionKey);

    return { sessionKey, channelChatKey };
  }

  assignToMessage<T extends Pick<InboundMessage, 'channel' | 'chatId'> & { sessionKey?: string }>(msg: T): T {
    const { sessionKey } = this.resolve(msg);
    msg.sessionKey = sessionKey;
    return msg;
  }

  createNewSession(channel: string, chatId: string): string {
    const sessionKey = this.sessionManager.createNewSession(channel, chatId);
    this.channelSessions.set(`${channel}:${chatId}`, sessionKey);
    return sessionKey;
  }

  switchSession(channel: string, chatId: string, sessionKey: string): void {
    this.channelSessions.set(`${channel}:${chatId}`, sessionKey);
  }

  getActiveSession(channel: string, chatId: string): string | undefined {
    return this.channelSessions.get(`${channel}:${chatId}`);
  }

  resolveByChannel(channel: string, chatId: string): string | undefined {
    return this.getActiveSession(channel, chatId);
  }

  getContextMode(): ContextMode {
    return this.contextMode;
  }

  setContextMode(contextMode: ContextMode): void {
    this.contextMode = contextMode;
  }

  getConversationAgent(channel: string, chatId: string): string | undefined {
    return this.conversationAgents.get(`${channel}:${chatId}`);
  }

  setConversationAgent(channel: string, chatId: string, agentName: string): void {
    this.conversationAgents.set(`${channel}:${chatId}`, agentName);
  }

  clearConversationAgent(channel: string, chatId: string): void {
    this.conversationAgents.delete(`${channel}:${chatId}`);
  }

  deleteAgentBindings(agentName: string): number {
    let deleted = 0;
    for (const [key, value] of this.conversationAgents.entries()) {
      if (value === agentName) {
        this.conversationAgents.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  private resolveSessionKey(channel: string, chatId: string, channelChatKey: string): string {
    return this.channelSessions.get(channelChatKey) || this.createNewSession(channel, chatId);
  }
}
