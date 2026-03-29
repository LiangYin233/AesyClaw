import type { InboundMessage } from '../../../types.js';
import type { SessionManager, ISessionRouting } from '../../../platform/context/index.js';

export interface SessionRoute {
  sessionKey: string;
  channelChatKey: string;
}

export class SessionRoutingService implements ISessionRouting {
  private channelSessions: Map<string, string> = new Map();
  private conversationAgents: Map<string, string> = new Map();

  constructor(
    private sessionManager: SessionManager,
    private contextMode: string = 'session'
  ) {}

  async resolve(msg: Pick<InboundMessage, 'channel' | 'chatId'> & { sessionKey?: string }): Promise<SessionRoute> {
    const channelChatKey = `${msg.channel}:${msg.chatId}`;
    const sessionKey = msg.sessionKey || await this.resolveSessionKey(msg.channel, msg.chatId, channelChatKey);
    this.channelSessions.set(channelChatKey, sessionKey);

    return { sessionKey, channelChatKey };
  }

  createNewSession(channel: string, chatId: string): string {
    if (this.contextMode === 'channel') {
      const sessionKey = this.buildChannelScopedSessionKey(channel, chatId);
      this.channelSessions.set(`${channel}:${chatId}`, sessionKey);
      return sessionKey;
    }

    const sessionKey = this.sessionManager.createNewSession(channel, chatId);
    this.channelSessions.set(`${channel}:${chatId}`, sessionKey);
    return sessionKey;
  }

  switchSession(channel: string, chatId: string, sessionKey: string): void {
    if (this.contextMode === 'channel') {
      return;
    }
    this.channelSessions.set(`${channel}:${chatId}`, sessionKey);
  }

  getActiveSession(channel: string, chatId: string): string | undefined {
    if (this.contextMode === 'channel') {
      return this.buildChannelScopedSessionKey(channel, chatId);
    }
    return this.channelSessions.get(`${channel}:${chatId}`);
  }

  resolveByChannel(channel: string, chatId: string): string | undefined {
    if (this.contextMode === 'channel') {
      return this.buildChannelScopedSessionKey(channel, chatId);
    }
    return this.getActiveSession(channel, chatId);
  }

  getContextMode(): string {
    return this.contextMode;
  }

  setContextMode(contextMode: string): void {
    this.contextMode = contextMode;
    if (contextMode === 'channel') {
      this.channelSessions.clear();
    }
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

  deleteSessionBinding(sessionKey: string, channel: string, chatId: string): void {
    if (this.contextMode === 'channel') {
      return;
    }

    const channelChatKey = `${channel}:${chatId}`;
    if (this.channelSessions.get(channelChatKey) === sessionKey) {
      this.channelSessions.delete(channelChatKey);
    }
  }

  private async resolveSessionKey(channel: string, chatId: string, channelChatKey: string): Promise<string> {
    if (this.contextMode === 'channel') {
      return this.buildChannelScopedSessionKey(channel, chatId);
    }

    const currentSessionKey = this.channelSessions.get(channelChatKey);
    if (!currentSessionKey) {
      return this.createNewSession(channel, chatId);
    }

    const existingSession = await this.sessionManager.get(currentSessionKey);
    if (existingSession) {
      return currentSessionKey;
    }

    this.channelSessions.delete(channelChatKey);
    return this.createNewSession(channel, chatId);
  }

  private buildChannelScopedSessionKey(channel: string, chatId: string): string {
    return `${channel}:${chatId}`;
  }
}
