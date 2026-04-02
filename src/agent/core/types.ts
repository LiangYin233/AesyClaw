export interface IUnifiedMessage {
  channelId: string;
  chatId: string;
  senderId: string;
  text: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface IOutboundMessage {
  text: string;
  mediaFiles?: Array<{
    type: string;
    url: string;
  }>;
  error?: string;
}

export interface IChannelContext {
  traceId: string;
  inbound: IUnifiedMessage;
  outbound: IOutboundMessage;
  createdAt: number;
}

export type MiddlewareFunc = (
  ctx: IChannelContext,
  next: () => Promise<void>
) => Promise<void>;
