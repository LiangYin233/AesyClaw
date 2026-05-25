/**
 * channel-registry — 频道注册表。
 *
 * 负责频道定义的注册/注销、磁盘发现、状态追踪。
 * 生命周期管理（start/stop/enable/disable）由 ChannelManager 负责。
 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import {
  discoverAndLoadExtensionModules,
  type ExtensionLoaderLogger,
} from '@aesyclaw/extension/extension-loader';
import {
  discoverChannelDefinition,
  isChannelEnabled,
  type ChannelLifecycleState,
  type ChannelPlugin,
  type ChannelStatus,
  type LoadedChannel,
} from './channel-types';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import { mergeDefaults } from '@aesyclaw/core/utils';

const logger = createScopedLogger('channel-registry');

export type ChannelRegistryDeps = {
  configManager: ConfigManager;
  paths: Readonly<ResolvedPaths>;
};

export class ChannelRegistry {
  readonly definitions = new Map<string, ChannelPlugin>();
  readonly loadedChannels = new Map<string, LoadedChannel>();
  readonly failedChannels = new Map<string, string>();
  readonly channelOwners = new Map<string, string>();
  private deps: ChannelRegistryDeps;

  constructor(deps: ChannelRegistryDeps) {
    this.deps = deps;
  }

  // ─── 注册 / 注销 ─────────────────────────────────────────────────

  /**
   * 注册频道定义。
   * @param channel - 频道插件定义
   * @param owner - 可选的所属方标识
   * @throws 频道名称已注册时抛出
   */
  register(channel: ChannelPlugin, owner?: string): void {
    const existing = this.definitions.get(channel.name);
    if (existing && existing !== channel) {
      throw new Error(`频道 "${channel.name}" 已注册`);
    }

    this.definitions.set(channel.name, channel);
    this.registerDefaults(channel);
    if (owner) {
      this.channelOwners.set(channel.name, owner);
    }
    logger.debug('频道已注册', { channel: channel.name });
  }

  /**
   * 检查频道是否已注册。
   */
  has(channelName: string): boolean {
    return this.definitions.has(channelName);
  }

  /**
   * 注销频道（仅清理注册表，不停止运行中实例）。
   */
  unregister(channelName: string): void {
    this.definitions.delete(channelName);
    this.failedChannels.delete(channelName);
    this.channelOwners.delete(channelName);
    logger.debug('频道已注销', { channel: channelName });
  }

  /**
   * 注销指定所有者注册的全部频道。
   * @param owner - 所有者标识
   */
  async unregisterByOwner(owner: string): Promise<void> {
    for (const [channelName, channelOwner] of this.channelOwners) {
      if (channelOwner === owner) {
        this.unregister(channelName);
      }
    }
  }

  // ─── 查询 ────────────────────────────────────────────────────────

  /** 获取已加载频道的运行时实例。 */
  getLoaded(channelName: string): LoadedChannel | undefined {
    return this.loadedChannels.get(channelName);
  }

  /** 获取所有已注册频道的定义信息。 */
  getRegisteredChannels(): Array<{
    name: string;
    version: string;
    description?: string;
    defaultConfig?: Record<string, unknown>;
  }> {
    return [...this.definitions.values()].map((def) => ({
      name: def.name,
      version: def.version,
      description: def.description,
      defaultConfig: def.defaultConfig,
    }));
  }

  /** 列出所有已注册频道的状态。 */
  listChannels(): ChannelStatus[] {
    const statuses: ChannelStatus[] = [];
    for (const definition of this.definitions.values()) {
      const enabled = this.isEnabled(definition.name);
      const error = this.failedChannels.get(definition.name);
      statuses.push({
        name: definition.name,
        version: definition.version,
        description: definition.description,
        enabled,
        state: resolveChannelState(error, this.loadedChannels.has(definition.name), enabled),
        error,
      });
    }
    return statuses.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ─── 磁盘发现 ───────────────────────────────────────────────────

  /** 从磁盘注册频道定义。 */
  async registerFromDisk(): Promise<void> {
    const modules = await discoverAndLoadExtensionModules({
      extensionsDir: this.deps.paths.extensionsDir,
      directoryPrefix: 'channel_',
      kind: 'Channel',
      logger: logger as ExtensionLoaderLogger,
      validate: discoverChannelDefinition,
      unreadableMessage: '频道扩展目录不可读',
      inspectFailureMessage: '检查频道目录候选失败',
      candidateField: 'channelDir',
      loadFailureMessage: '频道扩展加载失败',
    });
    for (const mod of modules) {
      this.register(mod.definition, 'disk');
    }
  }

  // ─── 内部方法 ────────────────────────────────────────────────────

  private registerDefaults(channel: ChannelPlugin): void {
    this.deps.configManager.registerDefaults(
      `channels.${channel.name}`,
      getManagedChannelDefaults(channel),
    );
  }

  private isEnabled(channelName: string): boolean {
    const definition = this.definitions.get(channelName);
    const config = definition
      ? this.getMergedConfig(definition)
      : this.getConfigRecord(channelName);
    return isChannelEnabled(config);
  }

  private getMergedConfig(definition: ChannelPlugin): Record<string, unknown> {
    const channelConfig = this.getConfigRecord(definition.name);
    return mergeDefaults(getManagedChannelDefaults(definition), channelConfig);
  }

  private getConfigRecord(channelName: string): Record<string, unknown> {
    try {
      const config = this.deps.configManager.get(`channels.${channelName}`);
      return isRecord(config) ? config : {};
    } catch {
      logger.debug('读取频道配置失败，使用空配置', { channelName });
      return {};
    }
  }

  getAllConfigRecords(): Record<string, unknown> {
    try {
      const config = this.deps.configManager.get('channels');
      return isRecord(config) ? { ...config } : {};
    } catch {
      logger.debug('读取全部频道配置失败，使用空配置');
      return {};
    }
  }
}

// ─── 模块级工具函数 ─────────────────────────────────────────────

function getManagedChannelDefaults(channel: ChannelPlugin): Record<string, unknown> {
  return { enabled: false, ...omitManagedChannelKeys(channel.defaultConfig ?? {}) };
}

function omitManagedChannelKeys(value: Record<string, unknown>): Record<string, unknown> {
  const { enabled: _enabled, ...rest } = value;
  return rest;
}

function resolveChannelState(
  error: string | undefined,
  loaded: boolean,
  enabled: boolean,
): ChannelLifecycleState {
  if (error) return 'failed';
  if (loaded) return 'loaded';
  if (enabled) return 'unloaded';
  return 'disabled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
