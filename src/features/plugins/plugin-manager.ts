import { logger } from '../../platform/observability/logger';
import { ToolRegistry } from '../../platform/tools/registry';
import { ChannelPipeline } from '../../agent/core/pipeline';
import { IPlugin, PluginContext, PluginInfo } from './types';
import type { PluginConfig } from '../config/schema';

export class PluginManager {
  private static instance: PluginManager;
  
  private toolRegistry: ToolRegistry;
  private pipeline: ChannelPipeline;
  private plugins: Map<string, IPlugin> = new Map();
  private pluginInfos: Map<string, PluginInfo> = new Map();

  private constructor(toolRegistry: ToolRegistry, pipeline: ChannelPipeline) {
    this.toolRegistry = toolRegistry;
    this.pipeline = pipeline;
  }

  static getInstance(toolRegistry: ToolRegistry, pipeline: ChannelPipeline): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager(toolRegistry, pipeline);
    }
    return PluginManager.instance;
  }

  static resetInstance(): void {
    if (PluginManager.instance) {
      PluginManager.instance.shutdown();
      PluginManager.instance = undefined as any;
    }
  }

  async loadPlugin(plugin: IPlugin, options?: Record<string, unknown>): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      logger.warn({ pluginName: plugin.name }, '插件已加载，跳过');
      return;
    }

    logger.info({ pluginName: plugin.name, description: plugin.description }, '加载插件');

    try {
      const context: PluginContext = {
        config: options || {},
        logger: {
          info: (msg, data) => logger.info({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
          warn: (msg, data) => logger.warn({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
          error: (msg, data) => logger.error({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
          debug: (msg, data) => logger.debug({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
        },
      };

      if (plugin.init) {
        await plugin.init(context);
      }

      if (plugin.tools) {
        for (const tool of plugin.tools) {
          this.toolRegistry.register(tool);
          logger.debug({ pluginName: plugin.name, toolName: tool.name }, '注册插件工具');
        }
      }

      if (plugin.middlewares) {
        for (const middleware of plugin.middlewares) {
          this.pipeline.use(middleware);
          logger.debug({ pluginName: plugin.name }, '注册插件中间件');
        }
      }

      this.plugins.set(plugin.name, plugin);
      this.pluginInfos.set(plugin.name, {
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        loaded: true,
        toolCount: plugin.tools?.length || 0,
        middlewareCount: plugin.middlewares?.length || 0,
      });

      logger.info({ pluginName: plugin.name }, '✅ 插件加载成功');
    } catch (error) {
      logger.error({ pluginName: plugin.name, error }, '❌ 插件加载失败');
    }
  }

  async unloadPlugin(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      logger.warn({ pluginName }, '插件未加载，跳过卸载');
      return;
    }

    try {
      if (plugin.destroy) {
        await plugin.destroy();
      }

      if (plugin.tools) {
        for (const tool of plugin.tools) {
          this.toolRegistry.unregister(tool.name);
        }
      }

      this.plugins.delete(pluginName);
      this.pluginInfos.delete(pluginName);

      logger.info({ pluginName }, '✅ 插件卸载成功');
    } catch (error) {
      logger.error({ pluginName, error }, '❌ 插件卸载失败');
    }
  }

  async loadEnabledPlugins(configs: PluginConfig[]): Promise<void> {
    logger.info({ count: configs.length }, '开始加载插件');

    const builtInPlugins = this.getBuiltInPlugins();

    for (const config of configs) {
      if (!config.enabled) {
        logger.debug({ pluginName: config.name }, '插件已禁用，跳过');
        continue;
      }

      const plugin = builtInPlugins.get(config.name);
      if (plugin) {
        await this.loadPlugin(plugin, config.options);
      } else {
        logger.warn({ pluginName: config.name }, '插件未找到');
      }
    }

    const loaded = this.getLoadedPlugins();
    logger.info({ loaded: loaded.length }, '插件加载完成');
  }

  private getBuiltInPlugins(): Map<string, IPlugin> {
    const plugins = new Map<string, IPlugin>();

    try {
      const { CodeExecPlugin } = require('./builtins/code-exec');
      plugins.set('code-exec', CodeExecPlugin);
    } catch (error) {
      logger.debug('内置插件 code-exec 不可用');
    }

    return plugins;
  }

  getLoadedPlugins(): PluginInfo[] {
    return Array.from(this.pluginInfos.values());
  }

  getPluginInfo(pluginName: string): PluginInfo | undefined {
    return this.pluginInfos.get(pluginName);
  }

  shutdown(): void {
    logger.info('关闭插件管理器');

    for (const [name, plugin] of this.plugins.entries()) {
      if (plugin.destroy) {
        plugin.destroy().catch((err) => {
          logger.error({ pluginName: name, error: err }, '插件销毁失败');
        });
      }
    }

    this.plugins.clear();
    this.pluginInfos.clear();
  }
}
