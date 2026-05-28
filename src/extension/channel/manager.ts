/**
 * 频道管理器 — 初始化频道适配器、管理注册表、消息路由。
 */

import {
  discoverAndLoadExtensionModules,
  type ExtensionLoaderLogger,
} from '@aesyclaw/extension/extension-loader';
import type {
  Message,
  OutboundSignal,
  SessionKey,
  SenderInfo,
} from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { validateWithSchema } from '@aesyclaw/core/config/schema-utils';
import { errorMessage } from '@aesyclaw/core/utils';
import type {
  ChannelManagerDependencies,
  ChannelPlugin,
  ChannelStatus,
  LoadedChannel,
} from './types';
import { isChannelEnabled, discoverChannelDefinition, type ChannelLifecycleState } from './types';
import * as router from './router';
import * as channelConfig from './config';
import * as ctxFactory from './context';

const logger = createScopedLogger('manager');

/**
 * 频道管理器 — 注册、启动、停止频道适配器，并将入站消息桥接到管道。
 */
export class ChannelManager {
  readonly definitions = new Map<string, ChannelPlugin>();
  readonly loadedChannels = new Map<string, LoadedChannel>();
  readonly failedChannels = new Map<string, string>();
  readonly channelOwners = new Map<string, string>();

  constructor(private readonly deps: ChannelManagerDependencies) {
    for (const channel of deps.channels ?? []) {
      this.register(channel);
    }
    logger.info('ChannelManager 已初始化');
  }

  // ─── ExtensionLifecycle ──────────────────────────────────────────

  /** 从磁盘注册频道定义并启动所有已启用的频道。 */
  async setup(): Promise<void> {
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
    await this.startAll();
  }

  /** 停止所有已加载的频道。 */
  async destroy(): Promise<void> {
    await this.stopAll();
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
    this.deps.configManager.registerDefaults(
      `channels.${channel.name}`,
      channelConfig.getManagedChannelDefaults(channel),
    );
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
   * 注销并停止指定频道。
   */
  async unregister(channelName: string): Promise<void> {
    await this.stop(channelName);
    this.definitions.delete(channelName);
    this.failedChannels.delete(channelName);
    this.channelOwners.delete(channelName);
    logger.debug('频道已注销', { channel: channelName });
  }

  /**
   * 注销指定所有者注册的全部频道。
   */
  async unregisterByOwner(owner: string): Promise<void> {
    for (const [channelName, channelOwner] of this.channelOwners) {
      if (channelOwner === owner) {
        await this.unregister(channelName);
      }
    }
  }

  // ─── 启动 / 停止 ─────────────────────────────────────────────────

  /** 启动所有已注册且已启用的频道。 */
  async startAll(): Promise<void> {
    for (const channel of this.definitions.values()) {
      if (!this.isEnabled(channel.name)) {
        this.failedChannels.delete(channel.name);
        logger.info('跳过已禁用的频道', { channel: channel.name });
        continue;
      }

      try {
        await this.start(channel.name);
      } catch (err) {
        this.failedChannels.set(channel.name, errorMessage(err));
        logger.error(`频道 "${channel.name}" 启动失败`, err);
      }
    }
  }

  /** 启用指定频道（写入配置并启动）。 */
  async enable(channelName: string): Promise<void> {
    await this.setChannelEnabled(channelName, true);
    if (this.definitions.has(channelName) && !this.loadedChannels.has(channelName)) {
      try {
        await this.start(channelName);
      } catch (err) {
        this.failedChannels.set(channelName, errorMessage(err));
        logger.error(`启用后频道 "${channelName}" 启动失败`, err);
      }
    }
  }

  /** 禁用指定频道（停止并写入配置）。 */
  async disable(channelName: string): Promise<void> {
    await this.stop(channelName);
    await this.setChannelEnabled(channelName, false);
  }

  /** 按逆序停止所有已加载的频道。 */
  async stopAll(): Promise<void> {
    const names = [...this.loadedChannels.keys()].reverse();
    for (const name of names) {
      try {
        await this.stop(name);
      } catch (err) {
        logger.error(`频道 "${name}" 停止失败`, err);
      }
    }
    logger.info('所有频道已停止');
  }

  /**
   * 启动指定频道（加载配置并调用 init）。
   *
   * @param channelName - 频道名称
   * @returns 已加载的频道
   * @throws 频道未注册时抛出
   */
  async start(channelName: string): Promise<LoadedChannel> {
    const definition = this.definitions.get(channelName);
    if (!definition) {
      throw new Error(`频道 "${channelName}" 未注册`);
    }

    if (this.loadedChannels.has(channelName)) {
      await this.stop(channelName);
    }

    let config = this.getMergedConfig(definition);
    if (!isChannelEnabled(config)) {
      return this.createUnloadedChannel(definition, config);
    }

    if (definition.configSchema) {
      config = validateWithSchema(definition.configSchema, config, `频道配置(${definition.name})`);
    }

    const state: Record<string, unknown> = {};
    const ref: { current: Record<string, unknown> } = { current: config };
    const context = ctxFactory.createContext(
      this.deps,
      this.deps.paths,
      definition.name,
      ref,
      async (msg, sk, sender) => {
        await this.receive(definition.name, msg, sk, sender);
      },
      state,
    );
    try {
      await definition.init(context);
    } catch (err) {
      this.cleanupRuntimeOwner(definition.name);
      throw err;
    }

    const loaded: LoadedChannel = {
      definition,
      config,
      loadedAt: new Date(),
      state,
    };
    this.loadedChannels.set(definition.name, loaded);
    this.failedChannels.delete(definition.name);
    logger.info('频道已启动', { channel: definition.name });
    return loaded;
  }

  /**
   * 停止指定频道（调用 destroy 并清理）。
   */
  async stop(channelName: string): Promise<void> {
    const loaded = this.loadedChannels.get(channelName);
    if (!loaded) {
      return;
    }

    try {
      if (loaded.definition.destroy) {
        await loaded.definition.destroy();
      }
    } finally {
      // 清理该频道的所有 chunk 缓冲区
      router.cleanupChunkBuffers(this.chunkBuffers, channelName);
      this.cleanupRuntimeOwner(channelName);
      this.loadedChannels.delete(channelName);
      this.failedChannels.delete(channelName);
      logger.info('频道已停止', { channel: channelName });
    }
  }

  // ─── 运行时 ──────────────────────────────────────────────────────

  /** 非流式频道的 chunk 缓冲区 — channel:session → 累积文本 */
  private readonly chunkBuffers = new Map<string, string>();

  async send(signal: OutboundSignal): Promise<void> {
    await router.send(this.deps.hooksBus, (n) => this.requireLoaded(n), this.chunkBuffers, signal);
  }

  /**
   * 接收入站消息并路由到管道处理。
   */
  async receive(
    channelName: string,
    inbound: Message,
    sessionKey: SessionKey,
    sender?: SenderInfo,
  ): Promise<void> {
    await router.receive(
      this.deps.hooksBus,
      this.deps.pipeline,
      (n) => this.requireLoaded(n),
      this.chunkBuffers,
      channelName,
      inbound,
      sessionKey,
      sender,
    );
  }

  /** 增量热重载：仅重启配置变更的频道，加载新增频道，卸载禁用的频道。 */
  async handleConfigReload(): Promise<void> {
    // Phase 1: 已加载的频道 — 配置变更则重启，定义移除或禁用则停止
    for (const [channelName, loaded] of [...this.loadedChannels]) {
      const definition = this.definitions.get(channelName);
      if (!definition) {
        // 频道定义已被移除 → 停止
        await this.stop(channelName);
        continue;
      }

      const freshConfig = this.getMergedConfig(definition);
      // 配置未变更 → 跳过
      if (JSON.stringify(loaded.config) === JSON.stringify(freshConfig)) continue;

      // 配置变更 → 重启（stop + start），start 内部会检查 enabled 状态
      logger.info(`频道 "${channelName}" 配置已变更，正在重启`);
      try {
        await this.stop(channelName);
        await this.start(channelName);
      } catch (err) {
        logger.error(`热重载时重启频道 "${channelName}" 失败`, err);
      }
    }

    // Phase 2: 已注册但未加载的频道 — 如果启用则启动
    for (const definition of this.definitions.values()) {
      if (this.loadedChannels.has(definition.name)) continue;
      if (!this.isEnabled(definition.name)) continue;

      try {
        await this.start(definition.name);
      } catch (err) {
        this.failedChannels.set(definition.name, errorMessage(err));
        logger.error(`热重载时启动频道 "${definition.name}" 失败`, err);
      }
    }
  }

  // ─── 查询 ────────────────────────────────────────────────────────

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

  // ─── 内部方法 ────────────────────────────────────────────────────

  private getMergedConfig(definition: ChannelPlugin): Record<string, unknown> {
    return channelConfig.getMergedConfig(this.deps.configManager, definition);
  }

  private isEnabled(channelName: string): boolean {
    return channelConfig.isEnabled(this.deps.configManager, this.definitions, channelName);
  }

  private async setChannelEnabled(channelName: string, enabled: boolean): Promise<void> {
    await channelConfig.setChannelEnabled(
      this.deps.configManager,
      this.definitions,
      channelName,
      enabled,
    );
  }

  private requireLoaded(channelName: string): LoadedChannel {
    const loaded = this.loadedChannels.get(channelName);
    if (!loaded) {
      throw new Error(`频道 "${channelName}" 未加载`);
    }
    return loaded;
  }

  private cleanupRuntimeOwner(channelName: string): void {
    const owner = channelRuntimeOwner(channelName);
    this.deps.toolRegistry.unregisterByOwner(owner);
    this.deps.commandRegistry.unregisterByScope(owner);
  }

  private createUnloadedChannel(
    definition: ChannelPlugin,
    config: Record<string, unknown>,
  ): LoadedChannel {
    return {
      definition,
      config,
      loadedAt: new Date(),
      state: {},
    };
  }
}

function channelRuntimeOwner(channelName: string): `channel:${string}` {
  return `channel:${channelName}`;
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
