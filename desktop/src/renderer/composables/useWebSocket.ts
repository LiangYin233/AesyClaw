/** useWebSocket composable — WebSocket 连接管理。
 *
 * 负责与后端的 WebSocket 通信，包括请求发送和响应处理。
 */

import { ref } from 'vue';

export type ChannelRequestHandler = (type: string, sessionId: string, data: unknown) => void;

export function useWebSocket() {
  const pendingChannelRequests = new Map<string, (data: unknown) => void>();
  const responseTypeMap: Record<string, string> = {
    get_sessions: 'sessions',
    get_session_messages: 'session_messages',
  };

  /** 通过 chat WebSocket 发送请求并等待响应事件 */
  async function channelRequest(type: string, payload?: Record<string, unknown>): Promise<unknown> {
    const responseType = responseTypeMap[type] ?? type;
    const sent = await window.aesyclaw.sendChatRaw(type, (payload?.['sessionId'] as string) ?? '');
    if (!sent) return [];
    return new Promise((resolve) => {
      const key = `${responseType}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      pendingChannelRequests.set(key, resolve);
      setTimeout(() => {
        pendingChannelRequests.delete(key);
        resolve([]);
      }, 10000);
    });
  }

  /** 处理来自 chat WebSocket 的响应事件 */
  function handleChannelResponse(
    type: string,
    _sessionId: string | undefined,
    data: unknown,
  ): boolean {
    let resolved = false;
    for (const [key, resolve] of pendingChannelRequests) {
      if (key.startsWith(type + ':')) {
        pendingChannelRequests.delete(key);
        resolve(data);
        resolved = true;
        break;
      }
    }
    return resolved;
  }

  return {
    channelRequest,
    handleChannelResponse,
  };
}
