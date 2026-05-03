/** 频道接口定义。 */

import type { InboundMessage, OutboundMessage, SendFn, SessionKey } from '../../core/types';
import type { Logger } from '../../core/logger';
import type { ConfigManager } from '../../core/config/config-manager';
import type { Pipeline } from '../../pipeline/pipeline';
import { isRecord } from '../../core/utils';

export type ChannelContext = {
  name: string;
  config: Record<string, unknown>;
  receiveWithSend(message: InboundMessage, send: SendFn): Promise<void>;
  logger: Logger;
}

export type ChannelPlugin = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  init(ctx: ChannelContext): Promise<void>;
  destroy?(): Promise<void>;
  send?(sessionKey: SessionKey, message: OutboundMessage): Promise<void>;
}

export type LoadedChannel = {
  definition: ChannelPlugin;
  config: Record<string, unknown>;
  loadedAt: Date;
}

export type ChannelLifecycleState = 'loaded' | 'disabled' | 'unloaded' | 'failed';

export type ChannelStatus = {
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
  state: ChannelLifecycleState;
  error?: string;
}

export type ChannelManagerDependencies = {
  configManager: ConfigManager;
  pipeline: Pipeline;
  channels?: ChannelPlugin[];
}

export type ChannelLoaderOptions = {
  extensionsDir?: string;
}

export type ChannelModule = {
  definition: ChannelPlugin;
  directory: string;
  directoryName: string;
  entryPath: string;
}

/**
 * 检查频道配置是否已启用。
 *
 * @param config - 频道配置对象
 * @returns 如果 enabled 不为 false 则返回 true
 */
export function isChannelEnabled(config: Record<string, unknown> | undefined): boolean {
  return config?.enabled !== false;
}

/**
 * 检查未知值是否符合 ChannelPlugin 结构。
 *
 * @param value - 要检查的值
 * @returns 如果是有效的 ChannelPlugin 则返回 true
 */
export function isChannelPlugin(value: unknown): value is ChannelPlugin {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.init === 'function' &&
    (value.destroy === undefined || typeof value.destroy === 'function') &&
    (value.send === undefined || typeof value.send === 'function') &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.defaultConfig === undefined || isRecord(value.defaultConfig))
  );
}
