/** WebSocket 消息类型定义。 */

export type WsMessage = {
  type: string;
  requestId?: string;
  data?: unknown;
};

export type WsResponse = {
  type: string;
  requestId?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};
