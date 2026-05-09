/** WebSocket 消息类型定义。 */

/** 客户端发送的 WebSocket 消息。 */
export type WsMessage = {
  type: string;
  requestId?: string;
  data?: unknown;
};

/** 服务端返回的 WebSocket 响应。 */
export type WsResponse = {
  type: string;
  requestId?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};
