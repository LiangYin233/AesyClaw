import * as fs from 'fs';
import * as path from 'path';
import type {
  PluginCommandRegistrar,
  PluginConfigStore,
  PluginRuntimeConfig,
} from '@/contracts/commands.js';
import { ToolRegistry } from '@/platform/tools/registry.js';
import { isPlainObject } from '@/platform/utils/index.js';
import { logger } from '@/platform/observability/logger.js';
import {
  IPlugin,
  PluginContext,
  PluginInfo,
  HookName,
  HookPayloadMessageReceive,
  HookPayloadBeforeLLMRequest,
  HookPayloadToolCall,
  HookPayloadAfterToolCall,
  HookPayloadMessageSend,
  HookPayloadMap,
  HookResultMap,
} from './types.js';

export interface PluginManagerDependencies {
  commandRegistrar: PluginCommandRegistrar;
  configStore: PluginConfigStore;
}

export class PluginManager {
  private toolRegistry: ToolRegistry;
  private deps: PluginManagerDependencies;
  private loadedPlugins: Map<string, IPlugin> = new Map();
  private pluginInfos: Map<string, PluginInfo> = new Map();
  private initialized: boolean = false;
  private pluginsDir: string;
  private pluginPaths: Map<string, { dir: string; packageJson: Record<string, unknown> }> = new Map();

  constructor(toolRegistry: ToolRegistry, deps: PluginManagerDependencies) {
    this.toolRegistry = toolRegistry;
    this.deps = deps;
    this.pluginsDir = path.join(process.cwd(), 'plugins');
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'PluginManager already initialized');
      return;
    }

    logger.info({}, 'Initializing PluginManager...');
    this.initialized = true;
  }

  async scanAndLoad(enabledPlugins: readonly PluginRuntimeConfig[]): Promise<void> {
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
          return p.name === pluginName || p.name === dir.name;
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
      const normalizedPath = this.normalizePath(pluginPath);
      const pluginModule = await import(normalizedPath);
      const plugin = pluginModule.default || pluginModule;

      if (!plugin || !plugin.name) {
        logger.warn({ pluginPath }, 'Invalid plugin module, missing name');
        return;
      }

      const packageJsonPath = path.join(path.dirname(pluginPath), 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (pkg.name && pkg.name !== plugin.name) {
          throw new Error(
            `Plugin name mismatch: package.json name is "${pkg.name}" but plugin.name is "${plugin.name}". They must match.`
          );
        }
      }

      await this.initializePlugin(plugin, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes('name mismatch')) {
        logger.error({ error: error.message }, 'Plugin validation failed');
        return;
      }
      logger.error({ pluginPath, error: String(error) }, 'Failed to dynamically import plugin');
      logger.info({ pluginName, pluginPath }, 'Trying to load as TypeScript source...');
      await this.loadPluginFromSource(pluginName, pluginPath.replace('.js', '.ts'), options);
    }
  }

  private normalizePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return `file:///${filePath.replace(/\\/g, '/')}`;
    }
    return filePath;
  }

  private async loadPluginFromSource(
    _pluginName: string,
    sourcePath: string,
    options: Record<string, unknown>
  ): Promise<void> {
    try {
      const normalizedPath = this.normalizePath(sourcePath);
      const tsxModule = await import(normalizedPath);
      const plugin = tsxModule.default || tsxModule;

      if (!plugin || !plugin.name) {
        logger.warn({ sourcePath }, 'Invalid plugin module, missing name');
        return;
      }

      const packageJsonPath = path.join(path.dirname(sourcePath), 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (pkg.name && pkg.name !== plugin.name) {
          logger.error(
            { packageName: pkg.name, pluginName: plugin.name },
            `Plugin name mismatch: package.json name is "${pkg.name}" but plugin.name is "${plugin.name}". They must match.`
          );
          return;
        }
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

    if (plugin.defaultOptions !== undefined) {
      this.deps.configStore.registerPluginDefaults(plugin.name, plugin.defaultOptions);
    }

    const mergedOptions = this.mergePluginOptions(plugin, options);

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
      config: mergedOptions,
      toolRegistry: this.toolRegistry,
    };

    try {
      if (plugin.init) {
        await plugin.init(context);
      }

      if (plugin.commands && plugin.commands.length > 0) {
        this.deps.commandRegistrar.registerFromPlugin(plugin.name, plugin.commands);
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

      logger.info({ pluginName: plugin.name }, 'Plugin loaded successfully');
    } catch (error) {
      logger.error({ pluginName: plugin.name, error }, 'Plugin initialization failed');
    }
  }

  private mergePluginOptions(
    plugin: IPlugin,
    userOptions: Record<string, unknown>
  ): Record<string, unknown> {
    const defaultOptions = plugin.defaultOptions || {};
    const merged = { ...defaultOptions };

    for (const key in userOptions) {
      if (Object.hasOwn(userOptions, key)) {
        const userValue = userOptions[key];
        const defaultValue = defaultOptions[key];

        if (isPlainObject(userValue) && isPlainObject(defaultValue)) {
          merged[key] = { ...defaultValue, ...userValue };
        } else {
          merged[key] = userValue;
        }
      }
    }

    return merged;
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
    let result: unknown = payload;

    for (const [, plugin] of this.loadedPlugins) {
      if (!plugin.hooks) continue;

      const hook = plugin.hooks[hookName];
      if (!hook) continue;

      try {
        logger.debug(
          { pluginName: plugin.name, hookName },
          'Dispatching hook'
        );

        const hookResult = await (hook as (payload: unknown) => Promise<unknown>)(result);

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

    return result as HookResultMap[K];
  }

  async dispatchMessageReceive(
    payload: HookPayloadMessageReceive
  ): Promise<HookPayloadMessageReceive['message'] | null> {
    const result = await this.dispatchHook('onMessageReceive', payload) as HookPayloadMessageReceive | HookPayloadMessageReceive['message'] | null;
    if (!result) return null;
    if ('message' in result) return result.message;
    return result;
  }

  async dispatchBeforeLLMRequest(
    payload: HookPayloadBeforeLLMRequest
  ): Promise<void> {
    await this.dispatchHook('beforeLLMRequest', payload);
  }

  async dispatchBeforeToolCall(
    toolCall: HookPayloadToolCall
  ): Promise<{ success: boolean; content: string; error?: string } | null> {
    const result = await this.dispatchHook('beforeToolCall', toolCall);
    if (result === null) {
      return null;
    }
    return result as { success: boolean; content: string; error?: string } | null;
  }

  async dispatchAfterToolCall(
    payload: HookPayloadAfterToolCall
  ): Promise<HookPayloadAfterToolCall['result']> {
    const result = await this.dispatchHook('afterToolCall', payload);
    return result as HookPayloadAfterToolCall['result'];
  }

  async dispatchMessageSend(
    payload: HookPayloadMessageSend
  ): Promise<HookPayloadMessageSend['message'] | null> {
    const result = await this.dispatchHook('onMessageSend', payload) as HookPayloadMessageSend | HookPayloadMessageSend['message'] | null;
    if (!result) return null;
    if ('message' in result) return result.message;
    return result;
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
        this.deps.commandRegistrar.unregisterFromPlugin(pluginName);
      }

      this.loadedPlugins.delete(pluginName);
      this.pluginInfos.delete(pluginName);

      logger.info({ pluginName }, 'Plugin unloaded successfully');
    } catch (error) {
      logger.error({ pluginName, error }, 'Plugin unload failed');
    }
  }

  async enablePlugin(pluginName: string): Promise<{ success: boolean; message: string }> {
    if (this.loadedPlugins.has(pluginName)) {
      return {
        success: false,
        message: `插件 "${pluginName}" 已经加载`,
      };
    }

    let pluginInfo = this.pluginPaths.get(pluginName);

    if (!pluginInfo) {
      if (!fs.existsSync(this.pluginsDir)) {
        return {
          success: false,
          message: `未找到插件 "${pluginName}"，插件目录不存在`,
        };
      }

      const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
      const pluginDirs = entries.filter(
        entry => entry.isDirectory() && entry.name.startsWith('plugin_')
      );

      let foundInScan = false;
      for (const dir of pluginDirs) {
        const pluginDir = path.join(this.pluginsDir, dir.name);
        const packageJsonPath = path.join(pluginDir, 'package.json');

        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          const pkgName = packageJson.name || dir.name;

          if (!this.pluginPaths.has(pkgName)) {
            this.pluginPaths.set(pkgName, { dir: pluginDir, packageJson });
          }

          if (pkgName === pluginName) {
            pluginInfo = { dir: pluginDir, packageJson };
            foundInScan = true;
            break;
          }
        }
      }

      if (!foundInScan && !pluginInfo) {
        return {
          success: false,
          message: `未找到插件 "${pluginName}"，请确认插件已存在于 plugins/ 目录`,
        };
      }
    }

    if (!pluginInfo) {
      return {
        success: false,
        message: `未找到插件 "${pluginName}"，请确认插件已存在于 plugins/ 目录`,
      };
    }

    try {
      const { dir: pluginDir, packageJson } = pluginInfo;
      const mainFile = (packageJson.main as string | undefined) || 'dist/index.js';
      const pluginPath = path.join(pluginDir, mainFile);

      if (fs.existsSync(pluginPath)) {
        await this.loadPluginFromDist(pluginName, pluginPath, {});
      } else {
        const srcPath = path.join(pluginDir, 'src/index.ts');
        if (fs.existsSync(srcPath)) {
          await this.loadPluginFromSource(pluginName, srcPath, {});
        } else {
          return {
            success: false,
            message: `插件 "${pluginName}" 入口文件不存在`,
          };
        }
      }

      if (!this.loadedPlugins.has(pluginName)) {
        return {
          success: false,
          message: `插件 "${pluginName}" 加载失败`,
        };
      }

      await this.deps.configStore.updatePluginConfig(pluginName, true);

      logger.info({ pluginName: pluginName }, 'Plugin enabled successfully');
      return {
        success: true,
        message: `插件 "${pluginName}" 已开启`,
      };
    } catch (error) {
      this.pluginPaths.delete(pluginName);
      this.loadedPlugins.delete(pluginName);
      this.pluginInfos.delete(pluginName);
      logger.error({ pluginName: pluginName, error }, 'Failed to enable plugin');
      return {
        success: false,
        message: `插件 "${pluginName}" 开启失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  async disablePlugin(pluginName: string): Promise<{ success: boolean; message: string }> {
    if (!this.loadedPlugins.has(pluginName)) {
      return {
        success: false,
        message: `插件 "${pluginName}" 未加载或不存在`,
      };
    }

    try {
      await this.unloadPlugin(pluginName);
      await this.deps.configStore.updatePluginConfig(pluginName, false);

      logger.info({ pluginName: pluginName }, 'Plugin disabled successfully');
      return {
        success: true,
        message: `插件 "${pluginName}" 已关闭`,
      };
    } catch (error) {
      logger.error({ pluginName: pluginName, error }, 'Failed to disable plugin');
      return {
        success: false,
        message: `插件 "${pluginName}" 关闭失败: ${error instanceof Error ? error.message : '未知错误'}`,
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
