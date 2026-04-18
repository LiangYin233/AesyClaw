import type { ChannelSendPayload } from '@/channels/channel-plugin.js';

export interface ChannelReceiveMessage {
  channelId: string;
  chatId: string;
  text: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface ChannelSendMessage {
  text: string;
  mediaFiles?: Array<{
    type: string;
    url: string;
    filename?: string;
  }>;
  error?: string;
}

export interface PipelineState {
  config?: {
    config: unknown;
  };
  session?: {
    sessionContext: unknown;
    sessionId: string;
  };
}

export interface ChannelContext {
  received: ChannelReceiveMessage;
  sendMessage: ChannelSendMessage;
  createdAt: number;
  state?: PipelineState;
  blocked?: boolean;
  send?: (_payload: ChannelSendPayload) => Promise<void>;
}

export type MiddlewareFunc = (
  _ctx: ChannelContext,
  _next: () => Promise<void>
) => Promise<void>;
