/** @file 频道运行时
 *
 * ChannelRuntime 负责加载和管理频道插件（channel_* 目录下的模块），
 * 支持配置热重载：当频道配置变更时，关闭所有频道并重新加载。
 *
 * 频道插件通过 ChannelPluginManager 注册，注入 pipeline 上下文
 * 以便将收到的消息注入系统处理流水线。
 */

import * as path from 'path';
import type { ChannelPipeline } from '@/agent/pipeline.js';
import { logger } from '@/platform/observability/logger.js';
import { loadDiscoveredModule } from '@/platform/utils/discovered-module-loader.js';
import { discoverPluginsByPrefix, type DiscoveredPlugin } from '@/platform/utils/plugin-discovery.js';
import { hasCanonicalValueChanged } from '@/platform/utils/canonical-stringify.js';
import type { ChannelPlugin } from './channel-plugin.js';
import { ChannelPluginManager } from './channel-manager.js';

/** 频道配置源，提供当前频道配置与变更监听 */
export interface ChannelRuntimeConfigSource {
  getChannelsConfig(): Record<string, unknown>;
  onChannelsConfigChange(
    listener: (next: Record<string, unknown>, previous: Record<string, unknown>) => Promise<void>
  ): () => void;
  syncDefaultConfigs(): Promise<void>;
}

interface ChannelRuntimeDependencies {
  channelManager: ChannelPluginManager;
  configSource: ChannelRuntimeConfigSource;
  getPipeline: () => ChannelPipeline | null;
}

/** 频道运行时
 *
 * 管理频道插件的加载、配置热重载与关闭。
 */
export class ChannelRuntime {
  private configChangeUnsubscribe: (() => void) | null = null;
  private hotReloadEnabled = false;

  constructor(private readonly deps: ChannelRuntimeDependencies) {}

  /** 获取当前已注册的频道数量 */
  getChannelCount(): number {
    return this.deps.channelManager.getChannelCount();
  }

  /** 加载所有频道插件 */
  async start(): Promise<void> {
    await this.loadChannelPlugins(this.deps.configSource.getChannelsConfig());
  }

  /** 启用配置热重载监听 */
  watchConfigChanges(): void {
    this.registerConfigChangeListener();
  }

  /** 关闭所有频道插件并取消配置监听 */
  async stop(): Promise<void> {
    this.configChangeUnsubscribe?.();
    this.configChangeUnsubscribe = null;
    this.hotReloadEnabled = false;
    await this.deps.channelManager.shutdown();
  }

  /** 加载所有 channel_* 目录下的频道插件 */
  private async loadChannelPlugins(channels: Record<string, unknown>): Promise<void> {
    const pipeline = this.deps.getPipeline();
    if (!pipeline) {
      logger.error({}, 'Pipeline not initialized, cannot load channel plugins');
      return;
    }

    this.deps.channelManager.setPipeline(pipeline);

    const pluginsDir = path.join(process.cwd(), 'plugins');
    for (const discovered of discoverPluginsByPrefix(pluginsDir, 'channel_')) {
      await this.loadChannelPluginEntry(discovered, channels);
    }

    logger.info({ loadedChannels: this.deps.channelManager.getChannelCount() }, 'Channel system initialized');
  }

  /** 加载单个频道插件 */
  private async loadChannelPluginEntry(
    discovered: DiscoveredPlugin,
    channels: Record<string, unknown>
  ): Promise<void> {
    const pluginName = discovered.dirName;

    try {
      const loaded = await loadDiscoveredModule<ChannelPlugin>(discovered, 'Channel plugin');
      if (!loaded.entryPath || !loaded.module) {
        logger.warn({ pluginName, candidates: loaded.candidates }, 'Channel plugin entry point not found');
        return;
      }

      const channelPlugin = loaded.module;

      const channelConfig = (channels[channelPlugin.name] as Record<string, unknown> | undefined) || {};
      const registered = await this.deps.channelManager.registerChannel(channelPlugin, channelConfig);
      if (registered) {
        logger.info({ channelName: channelPlugin.name }, `${channelPlugin.name} channel plugin loaded`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error: errorMessage, stack: errorStack, pluginName }, 'Failed to load channel plugin');
    }
  }

  /** 注册频道配置变更监听器
   *
   * 当频道配置的规范值发生变化时，关闭所有频道并重新加载。
   * 使用 hotReloadEnabled 标志防止递归触发。
   */
  private registerConfigChangeListener(): void {
    this.configChangeUnsubscribe?.();
    this.configChangeUnsubscribe = null;
    this.hotReloadEnabled = false;

    this.configChangeUnsubscribe = this.deps.configSource.onChannelsConfigChange(
      async (nextChannels, previousChannels) => {
        if (!this.hotReloadEnabled) {
          return;
        }
        if (!hasCanonicalValueChanged(previousChannels, nextChannels)) {
          return;
        }

        logger.info({}, 'Channel config changed, reloading channel plugins');
        this.hotReloadEnabled = false;
        try {
          await this.deps.channelManager.shutdown();
          await this.loadChannelPlugins(nextChannels);
          await this.deps.configSource.syncDefaultConfigs();
        } catch (error) {
          logger.error({ error }, 'Channel config reload failed');
          throw error;
        } finally {
          this.hotReloadEnabled = true;
        }
      }
    );

    this.hotReloadEnabled = true;
  }
}
