/** ExtensionManager — 统一管理插件和频道扩展的生命周期。 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { IHooksBus } from '@aesyclaw/hook';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import { PluginManager } from './plugin/plugin-manager';
import type { PluginStatus } from './plugin/plugin-types';
import { ChannelManager } from './channel/channel-manager';

const logger = createScopedLogger('extension-manager');

/** ExtensionManager 的依赖项集合。 */
export type ExtensionManagerDependencies = {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  hooksBus: IHooksBus;
  pipeline: Pipeline;
  paths: Readonly<ResolvedPaths>;
};

/**
 * 统一管理插件和频道扩展的生命周期。
 *
 * 负责编排 PluginManager 与 ChannelManager 的初始化、销毁及配置热重载。
 */
export class ExtensionManager {
  private readonly pluginManager: PluginManager;
  private readonly channelManager: ChannelManager;

  /**
   * @param deps - 扩展管理器所需的所有依赖项
   */
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
      hooksBus: deps.hooksBus,
      channelManager: this.channelManager,
      paths: deps.paths,
    });
  }

  /** 获取插件管理器。 */
  get plugins(): PluginManager {
    return this.pluginManager;
  }

  /** 获取频道管理器。 */
  get channels(): ChannelManager {
    return this.channelManager;
  }

  /** 初始化插件和频道管理器。 */
  async setup(): Promise<void> {
    // 先加载插件（插件 init 期间可能注册频道），再注册磁盘频道并启动全部
    await this.pluginManager.setup();
    await this.channelManager.setup();
    logger.info('ExtensionManager 已就绪');
  }

  /** 销毁频道和插件管理器。 */
  async destroy(): Promise<void> {
    await this.channelManager.destroy();
    await this.pluginManager.destroy();
    logger.info('ExtensionManager 已销毁');
  }

  // ─── 插件控制 ────────────────────────────────────────────────────

  /** 列出所有插件的运行时状态。 */
  async listPlugins(): Promise<PluginStatus[]> {
    return await this.pluginManager.listPlugins();
  }

  /** 获取所有已发现插件的定义信息。 */
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

  /** 启用指定插件。 */
  async enablePlugin(name: string): Promise<void> {
    await this.pluginManager.enable(name);
  }

  /** 禁用指定插件。 */
  async disablePlugin(name: string): Promise<void> {
    await this.pluginManager.disable(name);
  }

  // ─── 配置热重载 ──────────────────────────────────────────────────

  /** 热重载所有插件配置。 */
  async reloadPlugins(): Promise<void> {
    await this.pluginManager.handleConfigReload();
  }

  /** 热重载所有频道配置。 */
  async reloadChannels(): Promise<void> {
    await this.channelManager.handleConfigReload();
  }
}
