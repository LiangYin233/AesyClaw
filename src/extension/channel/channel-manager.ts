/**
 * 频道管理器 — 初始化频道适配器并将消息桥接到管道中。
 *
 * 频道注册与状态追踪委托给 ChannelRegistry，
 * 本文件专注生命周期管理（start/stop/enable/disable）和消息路由。
 */

import {
  serializeSessionKey,
  type Message,
  type OutboundSignal,
  type SessionKey,
  type SenderInfo,
} from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { errorMessage } from '@aesyclaw/core/utils';
import type {
  ChannelContext,
  ChannelManagerDependencies,
  ChannelPlugin,
  ChannelStatus,
  LoadedChannel,
} from './channel-types';
import { isChannelEnabled } from './channel-types';
import { ChannelRegistry, getManagedChannelDefaults } from './channel-registry';

const logger = createScopedLogger('channel-manager');

/**
 * 频道管理器 — 注册、启动、停止频道适配器，并将入站消息桥接到管道。
 */
export class ChannelManager {
  private registry: ChannelRegistry;

  constructor(private readonly deps: ChannelManagerDependencies) {
    this.registry = new ChannelRegistry({
      configManager: deps.configManager,
      paths: deps.paths,
    });
    for (const channel of deps.channels ?? []) {
      this.registry.register(channel);
    }
    logger.info('ChannelManager 已初始化');
  }

  /** 提供对内部注册表的只读访问（供 DesktopServer 等外部使用）。 */
  get registryRef(): ChannelRegistry {
    return this.registry;
  }

  // ─── ExtensionLifecycle ──────────────────────────────────────────

  /** 从磁盘注册频道定义并启动所有已启用的频道。 */
  async setup(): Promise<void> {
    await this.registry.registerFromDisk();
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
    this.registry.register(channel, owner);
  }

  /**
   * 检查频道是否已注册。
   */
  has(channelName: string): boolean {
    return this.registry.has(channelName);
  }

  /**
   * 注销并停止指定频道。
   */
  async unregister(channelName: string): Promise<void> {
    await this.stop(channelName);
    this.registry.unregister(channelName);
  }

  /**
   * 注销指定所有者注册的全部频道。
   */
  async unregisterByOwner(owner: string): Promise<void> {
    for (const [channelName, channelOwner] of this.registry.channelOwners) {
      if (channelOwner === owner) {
        await this.unregister(channelName);
      }
    }
  }

  // ─── 启动 / 停止 ─────────────────────────────────────────────────

  /** 启动所有已注册且已启用的频道。 */
  async startAll(): Promise<void> {
    for (const channel of this.registry.definitions.values()) {
      if (!this.isEnabled(channel.name)) {
        this.registry.failedChannels.delete(channel.name);
        logger.info('跳过已禁用的频道', { channel: channel.name });
        continue;
      }

      try {
        await this.start(channel.name);
      } catch (err) {
        this.registry.failedChannels.set(channel.name, errorMessage(err));
        logger.error(`频道 "${channel.name}" 启动失败`, err);
      }
    }
  }

  /** 启用指定频道（写入配置并启动）。 */
  async enable(channelName: string): Promise<void> {
    await this.setChannelEnabled(channelName, true);
    if (
      this.registry.definitions.has(channelName) &&
      !this.registry.loadedChannels.has(channelName)
    ) {
      try {
        await this.start(channelName);
      } catch (err) {
        this.registry.failedChannels.set(channelName, errorMessage(err));
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
    const names = [...this.registry.loadedChannels.keys()].reverse();
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
    const definition = this.registry.definitions.get(channelName);
    if (!definition) {
      throw new Error(`频道 "${channelName}" 未注册`);
    }

    if (this.registry.loadedChannels.has(channelName)) {
      await this.stop(channelName);
    }

    const config = this.getMergedConfig(definition);
    if (!isChannelEnabled(config)) {
      return this.createUnloadedChannel(definition, config);
    }

    const context = this.createContext(definition.name, config);
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
    };
    this.registry.loadedChannels.set(definition.name, loaded);
    this.registry.failedChannels.delete(definition.name);
    logger.info('频道已启动', { channel: definition.name });
    return loaded;
  }

  /**
   * 停止指定频道（调用 destroy 并清理）。
   */
  async stop(channelName: string): Promise<void> {
    const loaded = this.registry.loadedChannels.get(channelName);
    if (!loaded) {
      return;
    }

    try {
      if (loaded.definition.destroy) {
        await loaded.definition.destroy();
      }
    } finally {
      // 清理该频道的所有 chunk 缓冲区
      for (const key of this.chunkBuffers.keys()) {
        if (key.startsWith(`${channelName}:`)) {
          this.chunkBuffers.delete(key);
        }
      }
      this.cleanupRuntimeOwner(channelName);
      this.registry.loadedChannels.delete(channelName);
      this.registry.failedChannels.delete(channelName);
      logger.info('频道已停止', { channel: channelName });
    }
  }

  // ─── 运行时 ──────────────────────────────────────────────────────

  /** 非流式频道的 chunk 缓冲区 — channel:session → 累积文本 */
  private readonly chunkBuffers = new Map<string, string>();

  async send(signal: OutboundSignal): Promise<void> {
    const loaded = this.requireLoaded(signal.session.channel);

    if (loaded.definition.streaming) {
      await loaded.definition.send(signal);
      return;
    }

    // 非流式频道：缓存 chunk，done 时组装+过钩子后一次性发送
    const key = `${signal.session.channel}:${serializeSessionKey(signal.session)}`;

    switch (signal.kind) {
      case 'chunk':
        if (signal.text.length > 0) {
          this.chunkBuffers.set(key, (this.chunkBuffers.get(key) ?? '') + signal.text);
        }
        return;

      case 'done': {
        const accumulated = this.chunkBuffers.get(key) ?? '';
        this.chunkBuffers.delete(key);
        if (accumulated) {
          const message: Message = { components: [{ type: 'Plain', text: accumulated }] };
          const sendCtx = { message, sessionKey: signal.session };
          const result = await this.deps.hooksBus.dispatch('pipeline:send', sendCtx);
          const processed: Message = result.action === 'respond' ? result.message : message;
          await loaded.definition.send({
            kind: 'message',
            session: signal.session,
            content: processed,
            intermediate: false,
          });
        }
        return;
      }

      default:
        // message / toolCall / toolResult / error — 直接转发（message 已在 pipeline 中过钩子）
        await loaded.definition.send(signal);
        return;
    }
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
    this.requireLoaded(channelName);
    await this.deps.pipeline.receiveWithSend(inbound, sessionKey, sender, async (signal) => {
      await this.send(signal);
    });
  }

  /** 增量热重载：仅重启配置变更的频道，加载新增频道，卸载禁用的频道。 */
  async handleConfigReload(): Promise<void> {
    // Phase 1: 已加载的频道 — 配置变更则重启，定义移除或禁用则停止
    for (const [channelName, loaded] of [...this.registry.loadedChannels]) {
      const definition = this.registry.definitions.get(channelName);
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
    for (const definition of this.registry.definitions.values()) {
      if (this.registry.loadedChannels.has(definition.name)) continue;
      if (!this.isEnabled(definition.name)) continue;

      try {
        await this.start(definition.name);
      } catch (err) {
        this.registry.failedChannels.set(definition.name, errorMessage(err));
        logger.error(`热重载时启动频道 "${definition.name}" 失败`, err);
      }
    }
  }

  // ─── 查询 ────────────────────────────────────────────────────────

  /** 列出所有已注册频道的状态。 */
  listChannels(): ChannelStatus[] {
    return this.registry.listChannels();
  }

  /** 获取已加载频道的运行时实例。 */
  getLoaded(channelName: string): LoadedChannel | undefined {
    return this.registry.getLoaded(channelName);
  }

  /** 获取所有已注册频道的定义信息。 */
  getRegisteredChannels(): Array<{
    name: string;
    version: string;
    description?: string;
    defaultConfig?: Record<string, unknown>;
  }> {
    return this.registry.getRegisteredChannels();
  }

  // ─── 内部方法 ────────────────────────────────────────────────────

  private createContext(channelName: string, config: Record<string, unknown>): ChannelContext {
    return {
      name: channelName,
      config,
      configManager: this.deps.configManager,
      paths: this.deps.paths,
      receive: async (
        message: Message,
        sessionKey: SessionKey,
        sender?: SenderInfo,
      ): Promise<void> => {
        await this.receive(channelName, message, sessionKey, sender);
      },
      registerTool: (tool): void => {
        this.deps.toolRegistry.register({ ...tool, owner: channelRuntimeOwner(channelName) });
      },
      unregisterTool: (name): void => {
        const existing = this.deps.toolRegistry.get(name);
        if (!existing) {
          return;
        }
        const owner = channelRuntimeOwner(channelName);
        if (existing.owner !== owner) {
          logger.warn('频道尝试注销一个不属于自己的工具', {
            channelName,
            toolName: name,
            owner: existing.owner,
          });
          return;
        }
        this.deps.toolRegistry.unregister(name);
      },
      registerCommand: (command): void => {
        this.deps.commandRegistry.register({ ...command, scope: channelRuntimeOwner(channelName) });
      },
      getCommands: (): ReturnType<ChannelContext['getCommands']> => {
        return this.deps.commandRegistry
          .getAll()
          .map(({ execute: _execute, ...command }) => command);
      },
      logger: createScopedLogger(`channel:${channelName}`),
    };
  }

  private getMergedConfig(definition: ChannelPlugin): Record<string, unknown> {
    return this.registry.getMergedConfig(definition);
  }

  private getConfigRecord(channelName: string): Record<string, unknown> {
    return this.registry.getConfigRecord(channelName);
  }

  private isEnabled(channelName: string): boolean {
    return this.registry.isEnabled(channelName);
  }

  private getAllConfigRecords(): Record<string, unknown> {
    return this.registry.getAllConfigRecords();
  }

  private async setChannelEnabled(channelName: string, enabled: boolean): Promise<void> {
    const definition = this.registry.definitions.get(channelName);
    const current = this.getConfigRecord(channelName);
    const channels = this.getAllConfigRecords();
    const { enabled: _enabled, ...defaults } = definition
      ? getManagedChannelDefaults(definition)
      : {};
    channels[channelName] = {
      ...defaults,
      ...current,
      enabled,
    };
    await this.deps.configManager.set('channels', channels);
  }

  private requireLoaded(channelName: string): LoadedChannel {
    const loaded = this.registry.loadedChannels.get(channelName);
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
    };
  }
}

function channelRuntimeOwner(channelName: string): `channel:${string}` {
  return `channel:${channelName}`;
}
