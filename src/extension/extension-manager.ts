/** ExtensionManager — 统一管理插件和频道扩展。 */

import { createScopedLogger } from '../core/logger';
import { requireInitialized } from '../core/utils';
import type { Pipeline } from '../pipeline/pipeline';
import type { CommandRegistry } from '../command/command-registry';
import type { ToolRegistry } from '../tool/tool-registry';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import type { ConfigManager } from '../core/config/config-manager';
import { PluginManager } from './plugin/plugin-manager';
import { PluginLoader } from './plugin/plugin-loader';
import { ChannelManager } from './channel/channel-manager';

const logger = createScopedLogger('extension-manager');

export type ExtensionManagerDependencies = {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  hookRegistry: HookDispatcher;
  pipeline: Pipeline;
  extensionsDir: string;
};

export class ExtensionManager {
  private deps: ExtensionManagerDependencies | null = null;
  private pluginManager!: PluginManager;
  private channelManager!: ChannelManager;

  async initialize(deps: ExtensionManagerDependencies): Promise<void> {
    if (this.deps) {
      logger.warn('ExtensionManager 已初始化 — 跳过');
      return;
    }
    this.deps = deps;

    // ChannelManager first (no dependency on PluginManager)
    this.channelManager = new ChannelManager();
    await this.channelManager.initialize({
      configManager: deps.configManager,
      pipeline: deps.pipeline,
    });

    // PluginManager second (can reference channelManager for plugin channel registration)
    this.pluginManager = new PluginManager();
    await this.pluginManager.initialize({
      configManager: deps.configManager,
      toolRegistry: deps.toolRegistry,
      commandRegistry: deps.commandRegistry,
      hookRegistry: deps.hookRegistry,
      channelManager: this.channelManager,
      pluginLoader: new PluginLoader({ extensionsDir: deps.extensionsDir }),
    });

    logger.info('ExtensionManager 已初始化');
  }

  get plugins(): PluginManager {
    return this.pluginManager;
  }

  get channels(): ChannelManager {
    return this.channelManager;
  }

  private requireDeps(): ExtensionManagerDependencies {
    return requireInitialized(this.deps, 'ExtensionManager');
  }

  async loadPlugins(): Promise<void> {
    await this.pluginManager.loadAll();
  }

  async loadChannels(): Promise<void> {
    await this.channelManager.registerFromDisk(this.requireDeps().extensionsDir);
  }

  async startChannels(): Promise<void> {
    await this.channelManager.startAll();
  }

  async stopChannels(): Promise<void> {
    await this.channelManager.stopAll();
  }

  /** 销毁所有扩展（停止频道 + 卸载插件）。 */
  async destroy(): Promise<void> {
    await this.channelManager.stopAll();
    await this.channelManager.destroy();
    await this.pluginManager?.destroy();
    this.deps = null;
    logger.info('ExtensionManager 已销毁');
  }
}
