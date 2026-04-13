
import type { ChannelPipeline } from '../agent/pipeline.js';

export interface IOutboundPayload {
  text: string;
  mediaFiles?: Array<{ type: string; url: string }>;
}

export interface ChannelPluginLogger {
  info: (_msg: string, _data?: Record<string, unknown>) => void;
  warn: (_msg: string, _data?: Record<string, unknown>) => void;
  error: (_msg: string, _data?: Record<string, unknown>) => void;
  debug: (_msg: string, _data?: Record<string, unknown>) => void;
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
  init(_ctx: ChannelPluginContext): Promise<void>;
  destroy(): Promise<void>;
}

export interface IChannelWithSend extends IChannelPlugin {
  getSendFn(): (_payload: IOutboundPayload) => Promise<void>;
}
