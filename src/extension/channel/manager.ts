/**
 * ChannelManager — 频道生命周期管理，继承自 BaseExtensionManager。
 *
 * 负责频道的发现、加载、卸载、启用/禁用、消息路由及配置热重载。
 */

import { BaseExtensionManager } from '@aesyclaw/extension/base-manager';
import { createContext } from './context';
import * as router from './router';
import type {
  ChannelPlugin,
  ChannelContext,
  ChannelStatus,
  ChannelManagerDependencies,
} from './types';
import { discoverChannelDefinition } from './types';
import { discoverExtensionDirs, loadExtensionModule } from '@aesyclaw/extension/extension-loader';
import type { LoadedExtension } from '@aesyclaw/extension/types';
import type { Message, OutboundSignal, SessionKey, SenderInfo } from '@aesyclaw/core/types';

// ─── ChannelManager ───────────────────────────────────────────

/**
 * 频道管理器 — 注册、启动、停止频道适配器，并将入站消息桥接到管道。
 * 继承自 BaseExtensionManager，复用通用生命周期逻辑。
 */
export class ChannelManager extends BaseExtensionManager<ChannelPlugin, ChannelContext> {
  protected readonly extensionType = 'channel';
  protected readonly configKey = 'channels';
  protected readonly dirPrefix = 'channel_';

  /** 非流式频道的 chunk 缓冲区 — channel:session → 累积文本 */
  private readonly chunkBuffers = new Map<string, string>();

  constructor(private readonly deps: ChannelManagerDependencies) {
    super({
      configManager: deps.configManager,
      toolRegistry: deps.toolRegistry,
      commandRegistry: deps.commandRegistry,
      hooksBus: deps.hooksBus,
    });
    // 注册构造时传入的频道
    for (const channel of deps.channels ?? []) {
      this.register(channel);
    }
  }

  // ─── 抽象方法实现 ───────────────────────────────────────────

  protected createContext(
    definition: ChannelPlugin,
    _owner: string,
    ref: { current: Record<string, unknown> },
    state: Record<string, unknown>,
  ): ChannelContext {
    return createContext(
      this.deps,
      this.deps.paths,
      definition.name,
      ref,
      async (msg, sk, sender) => {
        await this.receive(definition.name, msg, sk, sender);
      },
      state,
    );
  }

  protected discoverDefinition(imported: unknown): ChannelPlugin | null {
    return discoverChannelDefinition(imported);
  }

  // 频道默认禁用（需要显式 enabled: true）
  protected getManagedDefaults(definition: ChannelPlugin): Record<string, unknown> {
    const { enabled: _enabled, ...defaults } = super.getManagedDefaults(definition);
    return { enabled: false, ...defaults };
  }

  // ─── 差异化钩子 ─────────────────────────────────────────────

  protected async onBeforeUnload(
    definition: ChannelPlugin,
    _context: ChannelContext,
  ): Promise<void> {
    // 清理该频道的所有 chunk 缓冲区
    router.cleanupChunkBuffers(this.chunkBuffers, definition.name);
  }

  protected async findExtensionOnDisk(
    name: string,
  ): Promise<{ definition: ChannelPlugin; directory?: string } | null> {
    const dirs = await discoverExtensionDirs({
      extensionsDir: this.deps.paths.extensionsDir,
      directoryPrefix: this.dirPrefix,
      logger: this.logger,
      unreadableMessage: '频道扩展目录不可读',
      inspectFailureMessage: '检查频道目录候选失败',
      candidateField: 'channelDir',
    });
    for (const dir of dirs) {
      try {
        const mod = await loadExtensionModule(dir, 'Channel', (imported) =>
          this.discoverDefinition(imported),
        );
        if (mod.definition.name === name) {
          return { definition: mod.definition, directory: dir };
        }
      } catch {
        // 跳过加载失败的目录
      }
    }
    return null;
  }

  // ─── 扩展基类方法 ───────────────────────────────────────────

  /**
   * 发现并加载所有已启用的频道。
   */
  async setup(): Promise<void> {
    await this.discoverFromDisk(this.deps.paths.extensionsDir);
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
   * 检查频道是否已注册。
   */
  has(channelName: string): boolean {
    return this.definitions.has(channelName);
  }

  /**
   * 增量热重载：仅重启配置变更的频道，加载新增频道，卸载禁用的频道。
   */
  async handleConfigReload(): Promise<void> {
    await super.handleConfigReload();
  }

  // ─── 消息路由 ───────────────────────────────────────────────

  /**
   * 出站消息路由入口。
   */
  async send(signal: OutboundSignal): Promise<void> {
    await router.send(this.hooksBus, (n) => this.requireLoaded(n), this.chunkBuffers, signal);
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
      (n) => this.requireLoaded(n),
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
    return this.listExtensions().map((ext) => ({
      ...ext,
      state: ext.state,
    }));
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
