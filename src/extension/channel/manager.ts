/*
 * ChannelManager — 频道生命周期 facade，委托统一 Extension host。
 *
 * 负责频道特有的消息路由，并将发现、加载、卸载、启用/禁用、热重载交给统一 host。
 */

import { BaseExtensionManager } from '@aesyclaw/extension/base-manager';
import { createChannelSpec } from './spec';
import * as router from './router';
import type {
  ChannelPlugin,
  ChannelContext,
  ChannelStatus,
  ChannelManagerDependencies,
} from './types';
import type { LoadedExtension } from '@aesyclaw/extension/types';
import type { Message, OutboundSignal, SessionKey, SenderInfo } from '@aesyclaw/core/types';

// ─── ChannelManager ───────────────────────────────────────────

/**
 * 频道管理器 — 注册、启动、停止频道适配器，并将入站消息桥接到管道。
 */
export class ChannelManager extends BaseExtensionManager<ChannelPlugin, ChannelContext> {
  /** 非流式频道的 chunk 缓冲区 — channel:session → 累积文本 */
  private readonly chunkBuffers: Map<string, string>;

  constructor(private readonly deps: ChannelManagerDependencies) {
    const chunkBuffers = new Map<string, string>();
    const receiveBridge: {
      current?: (
        channelName: string,
        inbound: Message,
        sessionKey: SessionKey,
        sender?: SenderInfo,
      ) => Promise<void>;
    } = {};
    super(
      createChannelSpec(deps, chunkBuffers, async (channelName, inbound, sessionKey, sender) => {
        const receive = receiveBridge.current;
        if (!receive) throw new Error('ChannelManager is not ready');
        await receive(channelName, inbound, sessionKey, sender);
      }),
      {
        configManager: deps.configManager,
        toolRegistry: deps.toolRegistry,
        commandRegistry: deps.commandRegistry,
        hooksBus: deps.hooksBus,
      },
    );
    this.chunkBuffers = chunkBuffers;
    receiveBridge.current = async (channelName, inbound, sessionKey, sender) => {
      await this.receive(channelName, inbound, sessionKey, sender);
    };

    for (const channel of deps.channels ?? []) {
      this.register(channel);
    }
  }

  /**
   * 发现并加载所有已启用的频道。
   */
  async setup(): Promise<void> {
    await this.discoverFromDisk();
    await this.startAll();
  }

  /**
   * 停止所有已加载的频道。
   */
  async destroy(): Promise<void> {
    await this.stopAll();
  }

  /**
   * 按所有者注销所有频道。
   */
  async unregisterByOwner(owner: string): Promise<void> {
    for (const [name, loaded] of this.loadedExtensions) {
      if (loaded.owner === owner) {
        await this.unregister(name);
      }
    }
  }

  // ─── 频道特有方法 ───────────────────────────────────────────

  /**
   * 列出当前内存中已知频道及其配置启用状态。
   */
  listEnabledChannels(): Array<{ name: string; enabled: boolean }> {
    return this.listEnabledExtensions();
  }

  /**
   * 获取当前内存中的完整频道定义。
   */
  getDefinition(name: string): ChannelPlugin {
    return super.getDefinition(name);
  }

  /**
   * 检查频道是否已注册。
   */
  has(channelName: string): boolean {
    return this.definitions.has(channelName);
  }

  // ─── 消息路由 ───────────────────────────────────────────────

  /**
   * 出站消息路由入口。
   */
  async send(signal: OutboundSignal): Promise<void> {
    await router.send(this.hooksBus, (name) => this.requireLoaded(name), this.chunkBuffers, signal);
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
      this.hooksBus,
      this.deps.pipeline,
      (name) => this.requireLoaded(name),
      this.chunkBuffers,
      channelName,
      inbound,
      sessionKey,
      sender,
    );
  }

  // ─── 查询方法 ───────────────────────────────────────────────

  /**
   * 列出所有已注册频道的状态。
   */
  listChannels(): ChannelStatus[] {
    return this.listExtensions();
  }

  /**
   * 获取已加载频道的运行时实例。
   */
  getLoadedChannel(
    channelName: string,
  ): LoadedExtension<ChannelPlugin, ChannelContext> | undefined {
    return this.getLoaded(channelName);
  }

  /**
   * 获取所有已注册频道的定义信息。
   */
  getRegisteredChannels(): Array<{
    name: string;
    version: string;
    description?: string;
    defaultConfig?: Record<string, unknown>;
  }> {
    return this.getRegisteredDefinitions().map((def) => ({
      name: def.name,
      version: def.version ?? '0.0.0',
      description: def.description,
      defaultConfig: def.defaultConfig,
    }));
  }

  // ─── 内部辅助方法 ───────────────────────────────────────────

  /**
   * 获取已加载的频道（未加载则抛出错误）。
   */
  private requireLoaded(channelName: string): LoadedExtension<ChannelPlugin, ChannelContext> {
    const loaded = this.getLoaded(channelName);
    if (!loaded) {
      throw new Error(`频道 "${channelName}" 未加载`);
    }
    return loaded;
  }
}
