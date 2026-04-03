import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../platform/observability/logger.js';
import { ToolRegistry } from '../../platform/tools/registry.js';
import {
  IPlugin,
  PluginContext,
  PluginInfo,
  HookName,
  PluginHooks,
  HookPayloadMessageReceive,
  HookPayloadBeforeLLMRequest,
  HookPayloadToolCall,
  HookPayloadAfterToolCall,
  HookPayloadMessageSend,
  HookPayloadMap,
  HookResultMap,
} from './types.js';
import type { PluginConfig } from '../config/schema.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { configManager } from '../config/config-manager.js';

export class PluginManager {
  private static instance: PluginManager;

  private toolRegistry: ToolRegistry;
  private loadedPlugins: Map<string, IPlugin> = new Map();
  private pluginInfos: Map<string, PluginInfo> = new Map();
  private initialized: boolean = false;
  private pluginsDir: string;
  private pluginPaths: Map<string, { dir: string; packageJson: any }> = new Map();

  private constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
    this.pluginsDir = path.resolve(process.cwd(), 'plugins');
  }

  static getInstance(toolRegistry: ToolRegistry): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager(toolRegistry);
    }
    return PluginManager.instance;
  }

  static resetInstance(): void {
    if (PluginManager.instance) {
      PluginManager.instance.shutdown();
      PluginManager.instance = undefined as any;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'PluginManager already initialized');
      return;
    }

    logger.info({}, '🔌 Initializing PluginManager...');
    this.initialized = true;
  }

  async scanAndLoad(enabledPlugins: PluginConfig[]): Promise<void> {
    logger.info({ pluginsDir: this.pluginsDir }, 'Scanning plugins directory');

    if (!fs.existsSync(this.pluginsDir)) {
      logger.warn({ pluginsDir: this.pluginsDir }, 'Plugins directory does not exist, creating...');
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    const pluginDirs = entries.filter(
      entry => entry.isDirectory() && entry.name.startsWith('plugin_')
    );

    logger.info({ found: pluginDirs.length }, 'Found plugin directories');

    for (const dir of pluginDirs) {
      const pluginDir = path.join(this.pluginsDir, dir.name);

      try {
        const packageJsonPath = path.join(pluginDir, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
          logger.warn({ pluginDir }, 'Plugin missing package.json, skipping');
          continue;
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const pluginName = packageJson.name || dir.name;

        this.pluginPaths.set(pluginName, { dir: pluginDir, packageJson });

        const config = enabledPlugins.find(p => {
          const configName = p.name.replace('@aesyclaw/plugin-', '').replace('plugin-', '');
          return configName === pluginName || configName === dir.name;
        });

        if (config && !config.enabled) {
          logger.info({ pluginName }, 'Plugin disabled in config, skipping');
          continue;
        }

        const mainFile = packageJson.main || 'dist/index.js';
        const pluginPath = path.join(pluginDir, mainFile);

        if (!fs.existsSync(pluginPath)) {
          logger.warn({ pluginPath }, 'Plugin main file not found, trying source path');
          const srcPath = path.join(pluginDir, 'src/index.ts');
          if (fs.existsSync(srcPath)) {
            await this.loadPluginFromSource(pluginName, srcPath, config?.options || {});
          } else {
            logger.warn({ pluginName }, 'Plugin entry point not found');
          }
        } else {
          await this.loadPluginFromDist(pluginName, pluginPath, config?.options || {});
        }
      } catch (error) {
        logger.error({ pluginDir, error }, 'Failed to load plugin from directory');
      }
    }

    logger.info(
      { loaded: this.loadedPlugins.size },
      'Plugin scanning and loading completed'
    );
  }

  private async loadPluginFromDist(
    pluginName: string,
    pluginPath: string,
    options: Record<string, unknown>
  ): Promise<void> {
    try {
      const pluginModule = await import(pluginPath);
      const plugin = pluginModule.default || pluginModule;

      if (!plugin || !plugin.name) {
        logger.warn({ pluginPath }, 'Invalid plugin module, missing name');
        return;
      }

      await this.initializePlugin(plugin, options);
    } catch (error) {
      logger.error({ pluginPath, error }, 'Failed to dynamically import plugin');
    }
  }

  private async loadPluginFromSource(
    pluginName: string,
    sourcePath: string,
    options: Record<string, unknown>
  ): Promise<void> {
    try {
      const tsxModule = await import(sourcePath);
      const plugin = tsxModule.default || tsxModule;

      if (!plugin || !plugin.name) {
        logger.warn({ sourcePath }, 'Invalid plugin module, missing name');
        return;
      }

      await this.initializePlugin(plugin, options);
    } catch (error) {
      logger.error({ sourcePath, error }, 'Failed to load plugin from source');
    }
  }

  private async initializePlugin(
    plugin: IPlugin,
    options: Record<string, unknown>
  ): Promise<void> {
    if (this.loadedPlugins.has(plugin.name)) {
      logger.warn({ pluginName: plugin.name }, 'Plugin already loaded, skipping');
      return;
    }

    logger.info(
      { pluginName: plugin.name, version: plugin.version },
      'Loading plugin'
    );

    const context: PluginContext = {
      logger: {
        info: (msg: string, data?: Record<string, unknown>) =>
          logger.info({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
        warn: (msg: string, data?: Record<string, unknown>) =>
          logger.warn({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
        error: (msg: string, data?: Record<string, unknown>) =>
          logger.error({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
        debug: (msg: string, data?: Record<string, unknown>) =>
          logger.debug({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
      },
      config: options,
      toolRegistry: this.toolRegistry,
    };

    try {
      if (plugin.init) {
        await plugin.init(context);
      }

      if (plugin.commands && plugin.commands.length > 0) {
        const commandRegistry = CommandRegistry.getInstance();
        commandRegistry.registerFromPlugin(plugin.name, plugin.commands);
      }

      this.loadedPlugins.set(plugin.name, plugin);
      this.pluginInfos.set(plugin.name, {
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        loaded: true,
        hooks: this.getPluginHookNames(plugin),
        commands: plugin.commands?.length || 0,
      });

      logger.info({ pluginName: plugin.name }, '✅ Plugin loaded successfully');
    } catch (error) {
      logger.error({ pluginName: plugin.name, error }, '❌ Plugin initialization failed');
    }
  }

  private getPluginHookNames(plugin: IPlugin): string[] {
    const hooks: string[] = [];
    if (plugin.hooks) {
      if (plugin.hooks.onMessageReceive) hooks.push('onMessageReceive');
      if (plugin.hooks.beforeLLMRequest) hooks.push('beforeLLMRequest');
      if (plugin.hooks.beforeToolCall) hooks.push('beforeToolCall');
      if (plugin.hooks.afterToolCall) hooks.push('afterToolCall');
      if (plugin.hooks.onMessageSend) hooks.push('onMessageSend');
    }
    return hooks;
  }

  async dispatchHook<K extends HookName>(
    hookName: K,
    payload: HookPayloadMap[K] | undefined
  ): Promise<HookResultMap[K]> {
    let result: any = payload;

    for (const [, plugin] of this.loadedPlugins) {
      if (!plugin.hooks) continue;

      const hook = plugin.hooks[hookName];
      if (!hook) continue;

      try {
        logger.debug(
          { pluginName: plugin.name, hookName },
          'Dispatching hook'
        );

        const hookResult = await hook(result);

        if (hookResult !== undefined && hookResult !== null) {
          result = hookResult;
        }
      } catch (error) {
        logger.error(
          { pluginName: plugin.name, hookName, error },
          'Hook execution failed'
        );
      }
    }

    return result;
  }

  async dispatchMessageReceive(
    payload: HookPayloadMessageReceive
  ): Promise<HookPayloadMessageReceive['message'] | null> {
    return this.dispatchHook('onMessageReceive', payload);
  }

  async dispatchBeforeLLMRequest(
    payload: HookPayloadBeforeLLMRequest
  ): Promise<void> {
    await this.dispatchHook('beforeLLMRequest', payload);
  }

  async dispatchBeforeToolCall(
    toolCall: HookPayloadToolCall
  ): Promise<{ success: boolean; content: string; error?: string } | null> {
    return this.dispatchHook('beforeToolCall', toolCall);
  }

  async dispatchAfterToolCall(
    payload: HookPayloadAfterToolCall
  ): Promise<HookPayloadAfterToolCall['result']> {
    return this.dispatchHook('afterToolCall', payload);
  }

  async dispatchMessageSend(
    payload: HookPayloadMessageSend
  ): Promise<HookPayloadMessageSend['message'] | null> {
    return this.dispatchHook('onMessageSend', payload);
  }

  async unloadPlugin(pluginName: string): Promise<void> {
    const plugin = this.loadedPlugins.get(pluginName);
    if (!plugin) {
      logger.warn({ pluginName }, 'Plugin not loaded, skipping unload');
      return;
    }

    try {
      if (plugin.destroy) {
        await plugin.destroy();
      }

      if (plugin.commands && plugin.commands.length > 0) {
        const commandRegistry = CommandRegistry.getInstance();
        commandRegistry.unregisterFromPlugin(pluginName);
      }

      this.loadedPlugins.delete(pluginName);
      this.pluginInfos.delete(pluginName);

      logger.info({ pluginName }, '✅ Plugin unloaded successfully');
    } catch (error) {
      logger.error({ pluginName, error }, '❌ Plugin unload failed');
    }
  }

  async enablePlugin(pluginName: string): Promise<{ success: boolean; message: string }> {
    const normalizedName = pluginName.replace('@aesyclaw/plugin-', '').replace('plugin-', '');

    if (this.loadedPlugins.has(normalizedName)) {
      return {
        success: false,
        message: `插件 "${normalizedName}" 已经加载`,
      };
    }

    let pluginInfo = this.pluginPaths.get(normalizedName);

    if (!pluginInfo) {
      if (!fs.existsSync(this.pluginsDir)) {
        return {
          success: false,
          message: `未找到插件 "${normalizedName}"，插件目录不存在`,
        };
      }

      const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
      const pluginDirs = entries.filter(
        entry => entry.isDirectory() && entry.name.startsWith('plugin_')
      );

      for (const dir of pluginDirs) {
        const pluginDir = path.join(this.pluginsDir, dir.name);
        const packageJsonPath = path.join(pluginDir, 'package.json');

        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          const pkgName = packageJson.name || dir.name;

          this.pluginPaths.set(pkgName, { dir: pluginDir, packageJson });

          const configName = pkgName.replace('@aesyclaw/plugin-', '').replace('plugin-', '');
          if (configName === normalizedName || pkgName === normalizedName) {
            pluginInfo = { dir: pluginDir, packageJson };
            break;
          }
        }
      }
    }

    if (!pluginInfo) {
      return {
        success: false,
        message: `未找到插件 "${normalizedName}"，请确认插件已存在于 plugins/ 目录`,
      };
    }

    try {
      const { dir: pluginDir, packageJson } = pluginInfo;
      const mainFile = packageJson.main || 'dist/index.js';
      const pluginPath = path.join(pluginDir, mainFile);

      if (fs.existsSync(pluginPath)) {
        await this.loadPluginFromDist(normalizedName, pluginPath, {});
      } else {
        const srcPath = path.join(pluginDir, 'src/index.ts');
        if (fs.existsSync(srcPath)) {
          await this.loadPluginFromSource(normalizedName, srcPath, {});
        } else {
          return {
            success: false,
            message: `插件 "${normalizedName}" 入口文件不存在`,
          };
        }
      }

      if (!this.loadedPlugins.has(normalizedName)) {
        return {
          success: false,
          message: `插件 "${normalizedName}" 加载失败`,
        };
      }

      await configManager.updatePluginConfig(normalizedName, true);

      logger.info({ pluginName: normalizedName }, '✅ Plugin enabled successfully');
      return {
        success: true,
        message: `✅ 插件 "${normalizedName}" 已开启`,
      };
    } catch (error) {
      this.pluginPaths.delete(normalizedName);
      logger.error({ pluginName: normalizedName, error }, '❌ Failed to enable plugin');
      return {
        success: false,
        message: `插件 "${normalizedName}" 开启失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  async disablePlugin(pluginName: string): Promise<{ success: boolean; message: string }> {
    const normalizedName = pluginName.replace('@aesyclaw/plugin-', '').replace('plugin-', '');

    if (!this.loadedPlugins.has(normalizedName)) {
      return {
        success: false,
        message: `插件 "${normalizedName}" 未加载或不存在`,
      };
    }

    try {
      await this.unloadPlugin(normalizedName);
      await configManager.updatePluginConfig(normalizedName, false);

      logger.info({ pluginName: normalizedName }, '✅ Plugin disabled successfully');
      return {
        success: true,
        message: `✅ 插件 "${normalizedName}" 已关闭`,
      };
    } catch (error) {
      logger.error({ pluginName: normalizedName, error }, '❌ Failed to disable plugin');
      return {
        success: false,
        message: `插件 "${normalizedName}" 关闭失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  getLoadedPlugins(): PluginInfo[] {
    return Array.from(this.pluginInfos.values());
  }

  getPluginInfo(pluginName: string): PluginInfo | undefined {
    return this.pluginInfos.get(pluginName);
  }

  isPluginLoaded(pluginName: string): boolean {
    return this.loadedPlugins.has(pluginName);
  }

  shutdown(): void {
    logger.info({}, 'Shutting down PluginManager');

    for (const [name, plugin] of this.loadedPlugins.entries()) {
      if (plugin.destroy) {
        plugin.destroy().catch((err) => {
          logger.error({ pluginName: name, error: err }, 'Plugin destroy failed');
        });
      }
    }

    this.loadedPlugins.clear();
    this.pluginInfos.clear();
    this.initialized = false;
  }

  getPluginCount(): number {
    return this.loadedPlugins.size;
  }

  getPluginsDir(): string {
    return this.pluginsDir;
  }

  setPluginsDir(dir: string): void {
    this.pluginsDir = dir;
    logger.info({ pluginsDir: this.pluginsDir }, 'Plugins directory updated');
  }
}

export const pluginManager = PluginManager.getInstance(
  ToolRegistry.getInstance()
);
