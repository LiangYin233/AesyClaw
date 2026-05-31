/**
 * 基础 API 客户端
 * 提供统一的 WebSocket 通信接口
 */

import { useWebSocket } from '@/composables/useWebSocket';
import type { WsResponse } from '@/composables/useWebSocket';

export class ApiClient {
  private ws = useWebSocket();

  /**
   * 发送请求并等待响应
   */
  async request<T = unknown>(type: string, data?: unknown, timeoutMs = 15_000): Promise<T> {
    try {
      const result = await this.ws.send(type, data, timeoutMs);
      return result as T;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : `Request failed: ${type}`);
    }
  }

  /**
   * 注册消息监听器
   */
  on(type: string, handler: (data: unknown) => void): void {
    this.ws.on(type, handler);
  }

  /**
   * 移除消息监听器
   */
  off(type: string, handler: (data: unknown) => void): void {
    this.ws.off(type, handler);
  }

  /**
   * 获取连接状态
   */
  get connected() {
    return this.ws.connected;
  }

  /**
   * 连接 WebSocket
   */
  connect(token: string): void {
    this.ws.connect(token);
  }

  /**
   * 断开 WebSocket
   */
  disconnect(): void {
    this.ws.disconnect();
  }
}

// 导出单例
export const apiClient = new ApiClient();
