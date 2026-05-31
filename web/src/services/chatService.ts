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

export class ChatService {
  /**
   * 发送消息
   */
  async sendMessage(params: SendMessageParams): Promise<Message> {
    return apiClient.request<Message>('send_message', params);
  }

  /**
   * 获取会话历史消息
   */
  async getMessages(sessionId: string, limit = 50): Promise<Message[]> {
    return apiClient.request<Message[]>('get_messages', { sessionId, limit });
  }

  /**
   * 清空会话历史
   */
  async clearHistory(sessionId: string): Promise<void> {
    await apiClient.request('clear_history', { sessionId });
  }

  /**
   * 监听新消息
   */
  onMessage(handler: (message: Message) => void): void {
    apiClient.on('new_message', (data: unknown) => handler(data as Message));
  }

  /**
   * 移除消息监听器
   */
  offMessage(handler: (message: Message) => void): void {
    apiClient.off('new_message', (data: unknown) => handler(data as Message));
  }

  /**
   * 监听流式消息
   */
  onStreamChunk(handler: (chunk: { sessionId: string; content: string }) => void): void {
    apiClient.on('stream_chunk', (data: unknown) => handler(data as { sessionId: string; content: string }));
  }

  /**
   * 移除流式消息监听器
   */
  offStreamChunk(handler: (chunk: { sessionId: string; content: string }) => void): void {
    apiClient.off('stream_chunk', (data: unknown) => handler(data as { sessionId: string; content: string }));
  }
}

export const chatService = new ChatService();
