/** 频道接口定义。 */

import type { Message, SessionKey, SenderInfo } from '@aesyclaw/core/types';
import type { Logger } from '@aesyclaw/core/logger';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import { isRecord } from '@aesyclaw/core/utils';
import { validateExtension } from '@aesyclaw/extension/extension-utils';

/** 频道初始化时接收的上下文（包含名称、配置、接收回调等）。 */
export type ChannelContext = {
  name: string;
  config: Record<string, unknown>;
  paths: Readonly<ResolvedPaths>;
  receive(message: Message, sessionKey: SessionKey, sender?: SenderInfo): Promise<void>;
  logger: Logger;
};

/** 频道插件必须导出的定义结构。 */
export type ChannelPlugin = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  init(ctx: ChannelContext): Promise<void>;
  destroy?(): Promise<void>;
  receive(message: Message, sessionKey: SessionKey, sender?: SenderInfo): Promise<void>;
  send(sessionKey: SessionKey, message: Message): Promise<void>;
};

/** 内存中已加载频道的运行时表示。 */
export type LoadedChannel = {
  definition: ChannelPlugin;
  config: Record<string, unknown>;
  loadedAt: Date;
};

/** 频道生命周期的 4 种状态。 */
export type ChannelLifecycleState = 'loaded' | 'disabled' | 'unloaded' | 'failed';

/** 前端查询单个频道时的状态快照。 */
export type ChannelStatus = {
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
  state: ChannelLifecycleState;
  error?: string;
};

/** ChannelManager 构造函数依赖项。 */
export type ChannelManagerDependencies = {
  configManager: ConfigManager;
  pipeline: Pipeline;
  channels?: ChannelPlugin[];
  paths: Readonly<ResolvedPaths>;
};

/** 从磁盘加载完成后的频道模块。 */
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
 * 支持静态 `default` 或 `channel` 导出。
 */
export function discoverChannelDefinition(imported: unknown): ChannelPlugin | null {
  if (!isRecord(imported)) {
    return null;
  }

  const candidate = (imported['default'] ?? imported['channel']) as unknown;
  if (candidate === null) return null;
  return isChannelPlugin(candidate) ? candidate : null;
}
