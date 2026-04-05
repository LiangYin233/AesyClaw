import type { IOutboundMessage } from '../agent/core/types.js';
import type { ChannelPipeline } from '../agent/core/pipeline.js';

export interface IOutboundPayload {
  text: string;
  mediaFiles?: Array<{ type: string; url: string }>;
}

export interface ChannelPluginLogger {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  debug: (msg: string, data?: Record<string, unknown>) => void;
}

export interface ChannelPluginContext {
  config?: Record<string, unknown>;
  logger: ChannelPluginLogger;
  pipeline: ChannelPipeline;
}

export interface IChannelPlugin {
  name: string;
  version: string;
  description?: string;
  defaultOptions?: Record<string, unknown>;
  init(ctx: ChannelPluginContext): Promise<void>;
  destroy(): Promise<void>;
}

export interface IChannelWithSend extends IChannelPlugin {
  getSendFn(): (payload: IOutboundPayload) => Promise<void>;
}
