/**
 * 聊天相关 API 服务
 */

import { apiClient } from './api';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  sessionId?: string;
}

export interface SendMessageParams {
  sessionId: string;
  content: string;
  role?: string;
}

export interface ChatSession {
  id: string;
  channelId: string;
  chatType: string;
  chatId: string;
  activeRoleId: string;
  createdAt: number;
  updatedAt: number;
}

export const chatService = {
  sendMessage(params: SendMessageParams): Promise<Message> {
    return apiClient.request<Message>('send_message', params);
  },

  getMessages(sessionId: string, limit = 50): Promise<Message[]> {
    return apiClient.request<Message[]>('get_messages', { sessionId, limit });
  },

  async clearHistory(sessionId: string): Promise<void> {
    await apiClient.request('clear_history', { sessionId });
  },

  onMessage(handler: (message: Message) => void): void {
    apiClient.on('new_message', (data: unknown) => handler(data as Message));
  },

  offMessage(handler: (message: Message) => void): void {
    apiClient.off('new_message', (data: unknown) => handler(data as Message));
  },

  onStreamChunk(handler: (chunk: { sessionId: string; content: string }) => void): void {
    apiClient.on('stream_chunk', (data: unknown) =>
      handler(data as { sessionId: string; content: string }),
    );
  },

  offStreamChunk(handler: (chunk: { sessionId: string; content: string }) => void): void {
    apiClient.off('stream_chunk', (data: unknown) =>
      handler(data as { sessionId: string; content: string }),
    );
  },
};
