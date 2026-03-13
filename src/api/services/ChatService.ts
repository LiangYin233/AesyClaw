import { randomUUID } from 'crypto';
import type { AgentRuntime } from '../../agent/AgentRuntime.js';
import { INTERNAL_CHANNELS } from '../../constants/index.js';

export interface ChatRequest {
  sessionKey?: string;
  message: string;
  channel?: string;
  chatId?: string;
}

export interface ChatResponse {
  success: true;
  response: string;
}

export class ChatService {
  constructor(private agentRuntime: Pick<AgentRuntime, 'handleDirect'>) {}

  async handleChat(request: ChatRequest): Promise<ChatResponse> {
    const resolvedChannel = request.channel?.trim() || INTERNAL_CHANNELS.WEBUI;
    const key = request.sessionKey || `${resolvedChannel}:${randomUUID()}`;
    const resolvedChatId = request.chatId?.trim() || request.sessionKey || key;

    const response = await this.agentRuntime.handleDirect(request.message, {
      sessionKey: key,
      channel: resolvedChannel,
      chatId: resolvedChatId,
      messageType: 'private'
    });

    return {
      success: true,
      response
    };
  }
}
