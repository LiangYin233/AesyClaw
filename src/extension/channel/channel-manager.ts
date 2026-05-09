/** 频道管理器 — 初始化频道适配器并将消息桥接到管道中。 */

import type { Message, SessionKey, SenderInfo } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { errorMessage, isRecord, mergeDefaults } from '@aesyclaw/core/utils';
import {
  discoverAndLoadExtensionModules,
  type ExtensionLifecycle,
  type ExtensionLoaderLogger,
} from '@aesyclaw/extension/extension-loader';
import type {
  ChannelContext,
  ChannelManagerDependencies,
  ChannelPlugin,
  ChannelStatus,
  LoadedChannel,
} from './channel-types';
import { isChannelEnabled, discoverChannelDefinition } from './channel-types';

const logger = createScopedLogger('channel-manager');

/**
 * 频道管理器 — 注册、启动、停止频道适配器，并将入站消息桥接到管道。
 *
 * @param deps - 频道管理器依赖项
 */
export class ChannelManager implements ExtensionLifecycle {
  private readonly definitions = new Map<string, ChannelPlugin>();
  private readonly loadedChannels = new Map<string, LoadedChannel>();
  private readonly failedChannels = new Map<string, string>();
  private readonly channelOwners = new Map<string, string>();

  constructor(private readonly deps: ChannelManagerDependencies) {
    for (const channel of this.definitions.values()) {
      this.registerDefaults(channel);
    }
    for (const channel of deps.channels ?? []) {
      this.register(channel);
    }
    logger.info('ChannelManager 已初始化');
  }

  // ─── ExtensionLifecycle ──────────────────────────────────────────

  /**
   * 从磁盘注册频道定义并启动所有已启用的频道。
   */
  async setup(): Promise<void> {
    await this.registerFromDisk();
    await this.startAll();
  }

  /** 停止所有已加载的频道。 */
  async destroy(): Promise<void> {
    await this.stopAll();
  }

  // ─── 注册 / 注销 ─────────────────────────────────────────────────

  /**
   * 注册频道定义。
   *
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
   *
   * @param channelName - 频道名称
   * @returns 已注册返回 true
   */
  has(channelName: string): boolean {
    return this.definitions.has(channelName);
  }

  /**
   * 注销并停止指定频道。
   *
   * @param channelName - 频道名称
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
   *
   * @param owner - 所有者标识
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

    const config = this.getMergedConfig(definition);
    if (!isChannelEnabled(config)) {
      return this.createUnloadedChannel(definition, config);
    }

    const context = this.createContext(definition.name, config);
    await definition.init(context);

    const loaded: LoadedChannel = {
      definition,
      config,
      loadedAt: new Date(),
    };
    this.loadedChannels.set(definition.name, loaded);
    this.failedChannels.delete(definition.name);
    logger.info('频道已启动', { channel: definition.name });
    return loaded;
  }

  /**
   * 停止指定频道（调用 destroy 并清理）。
   *
   * @param channelName - 频道名称
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
      this.loadedChannels.delete(channelName);
      this.failedChannels.delete(channelName);
      logger.info('频道已停止', { channel: channelName });
    }
  }

  // ─── 运行时 ──────────────────────────────────────────────────────

  /**
   * 通过已加载的频道发送消息。
   *
   * @param sessionKey - 会话键
   * @param message - 待发送的消息
   */
  async send(sessionKey: SessionKey, message: Message): Promise<void> {
    const loaded = this.requireLoaded(sessionKey.channel);
    await loaded.definition.send(sessionKey, message);
  }

  /**
   * 接收入站消息并路由到管道处理。
   *
   * @param channelName - 频道名称
   * @param inbound - 入站消息
   * @param sessionKey - 会话键
   * @param sender - 可选的发送者信息
   */
  async receive(
    channelName: string,
    inbound: Message,
    sessionKey: SessionKey,
    sender?: SenderInfo,
  ): Promise<void> {
    this.requireLoaded(channelName);
    await this.deps.pipeline.receiveWithSend(inbound, sessionKey, sender, async (outbound) => {
      await this.send(sessionKey, outbound);
    });
  }

  /** 停止全部频道并重新启动（配置热重载）。 */
  async handleConfigReload(): Promise<void> {
    await this.stopAll();
    await this.startAll();
  }

  // ─── 查询 ────────────────────────────────────────────────────────

  /**
   * 列出所有已注册频道的状态。
   *
   * @returns 按名称排序的频道状态列表
   */
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
        state: error
          ? 'failed'
          : this.loadedChannels.has(definition.name)
            ? 'loaded'
            : enabled
              ? 'unloaded'
              : 'disabled',
        error,
      });
    }
    return statuses.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 获取已加载频道的运行时实例。
   *
   * @param channelName - 频道名称
   * @returns 已加载的频道，未找到返回 undefined
   */
  getLoaded(channelName: string): LoadedChannel | undefined {
    return this.loadedChannels.get(channelName);
  }

  /**
   * 获取所有已注册频道的定义信息。
   *
   * @returns 频道定义数组（名称、版本、描述、默认配置）
   */
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

  private async registerFromDisk(): Promise<void> {
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

  private createContext(channelName: string, config: Record<string, unknown>): ChannelContext {
    return {
      name: channelName,
      config,
      paths: this.deps.paths,
      receive: async (
        message: Message,
        sessionKey: SessionKey,
        sender?: SenderInfo,
      ): Promise<void> => {
        await this.receive(channelName, message, sessionKey, sender);
      },
      logger: createScopedLogger(`channel:${channelName}`),
    };
  }

  private registerDefaults(channel: ChannelPlugin): void {
    if (!channel.defaultConfig) {
      return;
    }
    this.deps.configManager.registerDefaults(`channels.${channel.name}`, channel.defaultConfig);
  }

  private getMergedConfig(definition: ChannelPlugin): Record<string, unknown> {
    const channelConfig = this.getConfigRecord(definition.name);
    return mergeDefaults(definition.defaultConfig ?? {}, channelConfig);
  }

  private getConfigRecord(channelName: string): Record<string, unknown> {
    try {
      const config = this.deps.configManager.get(`channels.${channelName}`);
      return isRecord(config) ? config : {};
    } catch {
      return {};
    }
  }

  private isEnabled(channelName: string): boolean {
    return isChannelEnabled(this.getConfigRecord(channelName));
  }

  private requireLoaded(channelName: string): LoadedChannel {
    const loaded = this.loadedChannels.get(channelName);
    if (!loaded) {
      throw new Error(`频道 "${channelName}" 未加载`);
    }
    return loaded;
  }

  private createUnloadedChannel(
    definition: ChannelPlugin,
    config: Record<string, unknown>,
  ): LoadedChannel {
    return {
      definition,
      config,
      loadedAt: new Date(),
    };
  }
}
