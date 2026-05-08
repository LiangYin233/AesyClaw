/** ExtensionManager — 统一管理插件和频道扩展的生命周期。 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import { PluginManager } from './plugin/plugin-manager';
import type { PluginStatus } from './plugin/plugin-types';
import { ChannelManager } from './channel/channel-manager';

const logger = createScopedLogger('extension-manager');

export type ExtensionManagerDependencies = {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  hookRegistry: HookDispatcher;
  pipeline: Pipeline;
  paths: Readonly<ResolvedPaths>;
};

export class ExtensionManager {
  private readonly pluginManager: PluginManager;
  private readonly channelManager: ChannelManager;

  constructor(deps: ExtensionManagerDependencies) {
    // ChannelManager 先于 PluginManager（PluginManager 可选依赖 ChannelManager）
    this.channelManager = new ChannelManager({
      configManager: deps.configManager,
      pipeline: deps.pipeline,
      paths: deps.paths,
    });
    this.pluginManager = new PluginManager({
      configManager: deps.configManager,
      toolRegistry: deps.toolRegistry,
      commandRegistry: deps.commandRegistry,
      hookRegistry: deps.hookRegistry,
      channelManager: this.channelManager,
      paths: deps.paths,
    });
  }

  get plugins(): PluginManager {
    return this.pluginManager;
  }

  get channels(): ChannelManager {
    return this.channelManager;
  }

  async setup(): Promise<void> {
    // 先加载插件（插件 init 期间可能注册频道），再注册磁盘频道并启动全部
    await this.pluginManager.setup();
    await this.channelManager.setup();
    logger.info('ExtensionManager 已就绪');
  }

  async destroy(): Promise<void> {
    await this.channelManager.destroy();
    await this.pluginManager.destroy();
    logger.info('ExtensionManager 已销毁');
  }

  // ─── 插件控制 ────────────────────────────────────────────────────

  async listPlugins(): Promise<PluginStatus[]> {
    return await this.pluginManager.listPlugins();
  }

  async getPluginDefinitions(): Promise<
    Array<{
      name: string;
      version?: string;
      description?: string;
      defaultConfig?: Record<string, unknown>;
    }>
  > {
    return await this.pluginManager.getPluginDefinitions();
  }

  async enablePlugin(name: string): Promise<void> {
    await this.pluginManager.enable(name);
  }

  async disablePlugin(name: string): Promise<void> {
    await this.pluginManager.disable(name);
  }

  // ─── 配置热重载 ──────────────────────────────────────────────────

  async reloadPlugins(): Promise<void> {
    await this.pluginManager.handleConfigReload();
  }

  async reloadChannels(): Promise<void> {
    await this.channelManager.handleConfigReload();
  }
}
