/** 频道接口定义。 */

import type { InboundMessage, OutboundMessage, SessionKey } from '../../core/types';
import type { Logger } from '../../core/logger';
import type { ConfigManager } from '../../core/config/config-manager';
import type { Pipeline } from '../../pipeline/pipeline';
import { isRecord } from '../../core/utils';
import { validateExtension } from '../extension-utils';

export type ChannelContext = {
  name: string;
  config: Record<string, unknown>;
  receive(message: InboundMessage): Promise<void>;
  logger: Logger;
};

export type ChannelPlugin = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  init(ctx: ChannelContext): Promise<void>;
  destroy?(): Promise<void>;
  receive(message: InboundMessage): Promise<void>;
  send(sessionKey: SessionKey, message: OutboundMessage): Promise<void>;
};

export type LoadedChannel = {
  definition: ChannelPlugin;
  config: Record<string, unknown>;
  loadedAt: Date;
};

export type ChannelLifecycleState = 'loaded' | 'disabled' | 'unloaded' | 'failed';

export type ChannelStatus = {
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
  state: ChannelLifecycleState;
  error?: string;
};

export type ChannelManagerDependencies = {
  configManager: ConfigManager;
  pipeline: Pipeline;
  channels?: ChannelPlugin[];
  extensionsDir?: string;
};

export type ChannelModule = {
  definition: ChannelPlugin;
  directory: string;
  directoryName: string;
  entryPath: string;
};

/**
 * 检查频道配置是否已启用。
 *
 * @param config - 频道配置对象
 * @returns 如果 enabled 不为 false 则返回 true
 */
export function isChannelEnabled(config: Record<string, unknown> | undefined): boolean {
  return config?.['enabled'] !== false;
}

/**
 * 校验未知值是否符合 ChannelPlugin 结构。
 */
export function isChannelPlugin(value: unknown): value is ChannelPlugin {
  const validated = validateExtension<ChannelPlugin>(value);
  if (validated === false) return false;
  if (typeof validated['receive'] !== 'function') return false;
  if (typeof validated['send'] !== 'function') return false;
  return true;
}

/**
 * 从动态导入的模块中发现并校验频道定义。
 *
 * 支持多种导出形式：createChannel() 工厂、命名工厂、default/channel 导出。
 */
export function discoverChannelDefinition(imported: unknown): ChannelPlugin | null {
  if (!isRecord(imported)) {
    return null;
  }

  const candidate = findChannelCandidate(imported);
  if (candidate === null) return null;
  return isChannelPlugin(candidate) ? candidate : null;
}

function findChannelCandidate(imported: Record<string, unknown>): unknown | null {
  const factoryCandidate = imported['createChannel'];
  if (typeof factoryCandidate === 'function') {
    return factoryCandidate();
  }

  for (const [exportName, exported] of Object.entries(imported)) {
    if (!/^create[A-Z].*Channel$/.test(exportName) || typeof exported !== 'function') {
      continue;
    }
    return exported();
  }

  return imported['default'] ?? imported['channel'] ?? null;
}
