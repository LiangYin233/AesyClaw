/** WebSocket 消息类型定义。 */

export type WsMessage = {
  type: string;
  data?: unknown;
};

export type WsResponse = {
  type: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};
