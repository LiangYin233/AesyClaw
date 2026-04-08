import type { IOutboundPayload } from '../../channels/channel-plugin.js';

export interface IUnifiedMessage {
  channelId: string;
  chatId: string;
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
  state?: Record<string, unknown>;
  blocked?: boolean;
  sendFn?: (_payload: IOutboundPayload) => Promise<void>;
}

export type MiddlewareFunc = (
  _ctx: IChannelContext,
  _next: () => Promise<void>
) => Promise<void>;
