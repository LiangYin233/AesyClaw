/** useWebSocket composable — WebSocket 连接管理。
 *
 * 负责与后端的 WebSocket 通信，包括请求发送和响应处理。
 */

export type ChannelRequestHandler = (type: string, sessionId: string, data: unknown) => void;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useWebSocket() {
  const pendingChannelRequests = new Map<string, (data: unknown) => void>();
  const responseTypeMap: Record<string, string> = {
    get_sessions: 'sessions',
    get_session_messages: 'session_messages',
  };

  /** 通过 chat WebSocket 发送请求并等待响应事件 */
  async function channelRequest(type: string, payload?: Record<string, unknown>): Promise<unknown> {
    const responseType = responseTypeMap[type] ?? type;
    const requestId = `${responseType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return await new Promise((resolve) => {
      pendingChannelRequests.set(requestId, resolve);
      const timeout = setTimeout(() => {
        pendingChannelRequests.delete(requestId);
        resolve([]);
      }, 10000);

      void window.aesyclaw
        .sendChatRaw(type, (payload?.['sessionId'] as string) ?? '', requestId)
        .then((sent: boolean) => {
          if (sent === true) return;
          clearTimeout(timeout);
          pendingChannelRequests.delete(requestId);
          resolve([]);
        })
        .catch(() => {
          clearTimeout(timeout);
          pendingChannelRequests.delete(requestId);
          resolve([]);
        });
    });
  }

  /** 处理来自 chat WebSocket 的响应事件 */
  function handleChannelResponse(
    type: string,
    _sessionId: string | undefined,
    data: unknown,
    requestId?: string,
  ): boolean {
    let resolved = false;
    if (requestId) {
      const resolve = pendingChannelRequests.get(requestId);
      if (resolve) {
        pendingChannelRequests.delete(requestId);
        resolve(data);
        resolved = true;
      }
    }

    if (!resolved) {
      for (const [key, resolve] of pendingChannelRequests) {
        if (key.startsWith(type + '-')) {
          pendingChannelRequests.delete(key);
          resolve(data);
          resolved = true;
          break;
        }
      }
    }
    return resolved;
  }

  return {
    channelRequest,
    handleChannelResponse,
  };
}
