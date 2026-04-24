/** Channel interface definitions. */

import type { InboundMessage, OutboundMessage, SendFn, SessionKey } from '../core/types';
import type { Logger } from '../core/logger';

export interface ChannelContext {
  name: string;
  config: Record<string, unknown>;
  receiveWithSend(message: InboundMessage, send: SendFn): Promise<void>;
  logger: Logger;
}

export interface ChannelPlugin {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  init(ctx: ChannelContext): Promise<void>;
  destroy?(): Promise<void>;
  send?(sessionKey: SessionKey, message: OutboundMessage): Promise<void>;
}

export interface LoadedChannel {
  definition: ChannelPlugin;
  config: Record<string, unknown>;
  loadedAt: Date;
}

export type ChannelLifecycleState = 'loaded' | 'disabled' | 'unloaded' | 'failed';

export interface ChannelStatus {
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
  state: ChannelLifecycleState;
  error?: string;
}

export interface ChannelManagerDependencies {
  configManager: ChannelConfigManagerLike;
  pipeline: ChannelPipelineLike;
  channels?: ChannelPlugin[];
}

export interface ChannelConfigManagerLike {
  get(key: 'channels'): Readonly<Record<string, unknown>>;
  registerDefaults?(key: string, defaults: Record<string, unknown>): void;
}

export interface ChannelPipelineLike {
  receiveWithSend(message: InboundMessage, send: SendFn): Promise<void>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isChannelEnabled(config: Record<string, unknown> | undefined): boolean {
  return config?.enabled !== false;
}
