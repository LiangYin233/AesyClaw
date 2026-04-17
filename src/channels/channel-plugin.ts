import type { ChannelPipeline } from '@/agent/pipeline.js';
import type { ScopedLogger } from '@/platform/observability/logger.js';

export interface IOutboundPayload {
  text: string;
  mediaFiles?: Array<{ type: string; url: string }>;
}

export type ChannelPluginLogger = ScopedLogger;

export interface ChannelPluginContext<TOptions = Record<string, unknown>> {
  config?: TOptions;
  logger: ChannelPluginLogger;
  pipeline: ChannelPipeline;
}

export interface IChannelPlugin<TOptions = Record<string, unknown>> {
  name: string;
  version: string;
  description?: string;
  defaultOptions?: TOptions;
  init(_ctx: ChannelPluginContext<TOptions>): Promise<void>;
  destroy(): Promise<void>;
}
