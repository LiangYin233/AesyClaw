/**
 * 会话相关 API 服务
 */

import { apiClient } from './api';
import type { ChatSession } from './chatService';

export interface SessionListItem {
  id: string;
  channelId: string;
  chatType: string;
  chatId: string;
  activeRoleId: string;
  messageCount: number;
  lastMessageAt: number;
  createdAt: number;
}

export interface SessionDetail extends ChatSession {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;
}

export class SessionService {
  /**
   * 获取会话列表
   */
  async getSessions(): Promise<SessionListItem[]> {
    return apiClient.request<SessionListItem[]>('get_sessions');
  }

  /**
   * 获取会话详情
   */
  async getSession(sessionId: string): Promise<SessionDetail> {
    return apiClient.request<SessionDetail>('get_session', { sessionId });
  }

  /**
   * 创建新会话
   */
  async createSession(params: {
    channelId: string;
    chatType: string;
    chatId: string;
    roleId?: string;
  }): Promise<ChatSession> {
    return apiClient.request<ChatSession>('create_session', params);
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    await apiClient.request('delete_session', { sessionId });
  }

  /**
   * 切换会话角色
   */
  async switchRole(sessionId: string, roleId: string): Promise<void> {
    await apiClient.request('switch_role', { sessionId, roleId });
  }

  /**
   * 监听会话更新
   */
  onSessionUpdate(handler: (session: SessionListItem) => void): void {
    apiClient.on('session_update', (data: unknown) => handler(data as SessionListItem));
  }

  /**
   * 移除会话更新监听器
   */
  offSessionUpdate(handler: (session: SessionListItem) => void): void {
    apiClient.off('session_update', (data: unknown) => handler(data as SessionListItem));
  }
}

export const sessionService = new SessionService();
