import * as fs from 'fs';
import * as path from 'path';
import type {
  PluginCommandRegistrar,
  PluginConfigStore,
  PluginRuntimeConfig,
} from '@/contracts/commands.js';
import { ToolRegistry } from '@/platform/tools/registry.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { normalizeImportPath } from '@/platform/utils/import-path.js';
import { mergeDefaultOptions } from '@/platform/utils/merge-default-options.js';
import {
  assertPackageNameMatchesExportedName,
  type PackageManifest,
  readPackageManifest,
} from '@/platform/utils/package-manifest.js';
import {
  BeforeLLMRequestDispatchResult,
  BeforeToolCallDispatchResult,
  MessageReceiveDispatchResult,
  MessageSendDispatchResult,
  IPlugin,
  PluginContext,
  PluginInfo,
  PluginHooks,
  HookPayloadMessageReceive,
  HookPayloadBeforeLLMRequest,
  HookPayloadToolCall,
  HookPayloadAfterToolCall,
  HookPayloadMessageSend,
} from './types.js';

export interface PluginManagerDependencies {
  commandRegistrar: PluginCommandRegistrar;
  configStore: PluginConfigStore;
}

interface PluginPathInfo {
  dir: string;
  packageJson: PackageManifest;
}

interface PluginDirectoryInfo extends PluginPathInfo {
  pluginName: string;
  dirName: string;
}

export class PluginManager {
  private toolRegistry: ToolRegistry;
  private deps: PluginManagerDependencies;
  private loadedPlugins: Map<string, IPlugin> = new Map();
  private pluginInfos: Map<string, PluginInfo> = new Map();
  private initialized: boolean = false;
  private pluginsDir: string;
  private pluginPaths: Map<string, PluginPathInfo> = new Map();

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
    this.pluginPaths.clear();

    if (!fs.existsSync(this.pluginsDir)) {
      logger.warn({ pluginsDir: this.pluginsDir }, 'Plugins directory does not exist, creating...');
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      return;
    }

    const pluginDirs = this.getPluginDirectories();

    logger.info({ found: pluginDirs.length }, 'Found plugin directories');

    for (const dir of pluginDirs) {
      try {
        const pluginInfo = this.readPluginDirectoryInfo(dir);
        if (!pluginInfo) {
          continue;
        }

        this.pluginPaths.set(pluginInfo.pluginName, {
          dir: pluginInfo.dir,
          packageJson: pluginInfo.packageJson,
        });

        const config = this.findPluginRuntimeConfig(
          enabledPlugins,
          pluginInfo.pluginName,
          pluginInfo.dirName
        );

        if (config && !config.enabled) {
          logger.info({ pluginName: pluginInfo.pluginName }, 'Plugin disabled in config, skipping');
          continue;
        }

        await this.loadPluginFromEntry(pluginInfo, config?.options || {});
      } catch (error) {
        logger.error({ pluginDir: path.join(this.pluginsDir, dir.name), error }, 'Failed to load plugin from directory');
      }
    }

    logger.info(
      { loaded: this.loadedPlugins.size },
      'Plugin scanning and loading completed'
    );
  }

  private getPluginDirectories(): fs.Dirent[] {
    return fs.readdirSync(this.pluginsDir, { withFileTypes: true }).filter(
      entry => entry.isDirectory() && entry.name.startsWith('plugin_')
    );
  }

  private readPluginDirectoryInfo(entry: fs.Dirent): PluginDirectoryInfo | null {
    const pluginDir = path.join(this.pluginsDir, entry.name);
    const packageJsonPath = path.join(pluginDir, 'package.json');
    const packageJson = readPackageManifest(packageJsonPath);
    if (!packageJson) {
      logger.warn({ pluginDir }, 'Plugin missing package.json, skipping');
      return null;
    }

    return {
      dir: pluginDir,
      dirName: entry.name,
      packageJson,
      pluginName: packageJson.name || entry.name,
    };
  }

  private findPluginRuntimeConfig(
    enabledPlugins: readonly PluginRuntimeConfig[],
    pluginName: string,
    dirName: string
  ): PluginRuntimeConfig | undefined {
    return enabledPlugins.find(p => {
      return p.name === pluginName || p.name === dirName;
    });
  }

  private resolvePluginEntryPaths(pluginDir: string, packageJson: PackageManifest): {
    distPath: string;
    sourcePath: string;
  } {
    const mainFile = packageJson.main || 'dist/index.js';

    return {
      distPath: path.join(pluginDir, mainFile),
      sourcePath: path.join(pluginDir, 'src/index.ts'),
    };
  }

  private async loadPluginFromEntry(
    pluginInfo: PluginDirectoryInfo | PluginPathInfo & { pluginName: string },
    options: Record<string, unknown>,
    registerDefaults = true
  ): Promise<void> {
    const { distPath, sourcePath } = this.resolvePluginEntryPaths(
      pluginInfo.dir,
      pluginInfo.packageJson
    );

    if (!fs.existsSync(distPath)) {
      logger.warn({ pluginPath: distPath }, 'Plugin main file not found, trying source path');
      if (fs.existsSync(sourcePath)) {
        await this.loadPluginFromSource(pluginInfo.pluginName, sourcePath, options, registerDefaults);
      } else {
        logger.warn({ pluginName: pluginInfo.pluginName }, 'Plugin entry point not found');
      }

      return;
    }

    await this.loadPluginFromDist(pluginInfo.pluginName, distPath, options, registerDefaults);
  }

  private findPluginInDirectoryScan(pluginName: string): PluginPathInfo | undefined {
    for (const dir of this.getPluginDirectories()) {
      const pluginInfo = this.readPluginDirectoryInfo(dir);
      if (!pluginInfo) {
        continue;
      }

      if (!this.pluginPaths.has(pluginInfo.pluginName)) {
        this.pluginPaths.set(pluginInfo.pluginName, {
          dir: pluginInfo.dir,
          packageJson: pluginInfo.packageJson,
        });
      }

      if (pluginInfo.pluginName === pluginName) {
        return {
          dir: pluginInfo.dir,
          packageJson: pluginInfo.packageJson,
        };
      }
    }

    return undefined;
  }

  private async loadPluginFromDist(
    pluginName: string,
    pluginPath: string,
    options: Record<string, unknown>,
    registerDefaults = true
  ): Promise<void> {
    try {
      const normalizedPath = normalizeImportPath(pluginPath);
      const pluginModule = await import(normalizedPath);
      const plugin = pluginModule.default || pluginModule;

      if (!plugin || !plugin.name) {
        logger.warn({ pluginPath }, 'Invalid plugin module, missing name');
        return;
      }

      const packageJsonPath = path.join(path.dirname(pluginPath), 'package.json');
      assertPackageNameMatchesExportedName(
        readPackageManifest(packageJsonPath),
        plugin.name,
        'Plugin'
      );

      await this.initializePlugin(plugin, options, registerDefaults);
    } catch (error) {
      if (error instanceof Error && error.message.includes('name mismatch')) {
        logger.error({ error: error.message }, 'Plugin validation failed');
        return;
      }
      logger.error({ pluginPath, error: String(error) }, 'Failed to dynamically import plugin');
      logger.info({ pluginName, pluginPath }, 'Trying to load as TypeScript source...');
      await this.loadPluginFromSource(pluginName, pluginPath.replace('.js', '.ts'), options, registerDefaults);
    }
  }

  private async loadPluginFromSource(
    _pluginName: string,
    sourcePath: string,
    options: Record<string, unknown>,
    registerDefaults = true
  ): Promise<void> {
    try {
      const normalizedPath = normalizeImportPath(sourcePath);
      const tsxModule = await import(normalizedPath);
      const plugin = tsxModule.default || tsxModule;

      if (!plugin || !plugin.name) {
        logger.warn({ sourcePath }, 'Invalid plugin module, missing name');
        return;
      }

      const packageJsonPath = path.join(path.dirname(sourcePath), 'package.json');
      const packageManifest = readPackageManifest(packageJsonPath);
      if (packageManifest) {
        try {
          assertPackageNameMatchesExportedName(packageManifest, plugin.name, 'Plugin');
        } catch (error) {
          logger.error(
            { packageName: packageManifest.name, pluginName: plugin.name },
            toErrorMessage(error)
          );
          return;
        }
      }

      await this.initializePlugin(plugin, options, registerDefaults);
    } catch (error) {
      logger.error({ sourcePath, error }, 'Failed to load plugin from source');
    }
  }

  private async initializePlugin(
    plugin: IPlugin,
    options: Record<string, unknown>,
    registerDefaults = true
  ): Promise<void> {
    if (this.loadedPlugins.has(plugin.name)) {
      logger.warn({ pluginName: plugin.name }, 'Plugin already loaded, skipping');
      return;
    }

    logger.info(
      { pluginName: plugin.name, version: plugin.version },
      'Loading plugin'
    );

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

      if (registerDefaults && plugin.defaultOptions !== undefined) {
        this.deps.configStore.registerDefaults('plugin', plugin.name, plugin.defaultOptions);
      }

      logger.info({ pluginName: plugin.name }, 'Plugin loaded successfully');
    } catch (error) {
      if (plugin.destroy) {
        try {
          await plugin.destroy();
        } catch (cleanupError) {
          logger.error({ pluginName: plugin.name, error: cleanupError }, 'Plugin cleanup after initialization failure failed');
        }
      }
      logger.error({ pluginName: plugin.name, error }, 'Plugin initialization failed');
    }
  }

  private mergePluginOptions(
    plugin: IPlugin,
    userOptions: Record<string, unknown>
  ): Record<string, unknown> {
    return mergeDefaultOptions(plugin.defaultOptions || {}, userOptions);
  }

  private getConfiguredPlugin(pluginName: string): PluginRuntimeConfig | undefined {
    return this.deps.configStore.config.plugins.find((plugin) => plugin.name === pluginName);
  }

  private buildUpdatedPluginConfigs(
    pluginName: string,
    enabled: boolean,
    options?: Record<string, unknown>
  ): PluginRuntimeConfig[] {
    const plugins = this.deps.configStore.config.plugins.map((plugin) => ({
      ...plugin,
      options: plugin.options ? { ...plugin.options } : {},
    }));
    const index = plugins.findIndex((plugin) => plugin.name === pluginName);

    if (index >= 0) {
      plugins[index].enabled = enabled;
      if (options) {
        plugins[index].options = options;
      }
      return plugins;
    }

    plugins.push({ name: pluginName, enabled, options: options || {} });
    return plugins;
  }

  private async persistPluginConfig(
    pluginName: string,
    enabled: boolean,
    options?: Record<string, unknown>
  ): Promise<void> {
    const updated = await this.deps.configStore.updateConfig({
      plugins: this.buildUpdatedPluginConfigs(pluginName, enabled, options),
    });
    if (!updated) {
      throw new Error(`Failed to persist plugin config for "${pluginName}"`);
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

  private async forEachPluginHook<K extends keyof PluginHooks>(
    hookName: K,
    callback: (hookFn: NonNullable<PluginHooks[K]>) => Promise<boolean | void>
  ): Promise<void> {
    for (const [, plugin] of this.loadedPlugins) {
      const hookFn = plugin.hooks?.[hookName];
      if (!hookFn) continue;
      try {
        logger.debug({ pluginName: plugin.name, hookName }, 'Dispatching hook');
        if (await callback(hookFn)) return;
      } catch (error) {
        logger.error({ pluginName: plugin.name, hookName, error }, 'Hook execution failed');
      }
    }
  }

  async dispatchMessageReceive(
    payload: HookPayloadMessageReceive
  ): Promise<MessageReceiveDispatchResult> {
    let message = payload.message;
    let blockResult: MessageReceiveDispatchResult | undefined;

    await this.forEachPluginHook('onMessageReceive', async (hookFn) => {
      const result = await hookFn({ message });
      if (result.action === 'block') {
        blockResult = { blocked: true, reason: result.reason };
        return true;
      }
      message = result.value;
    });

    return blockResult ?? { blocked: false, message };
  }

  async dispatchBeforeLLMRequest(
    payload: HookPayloadBeforeLLMRequest
  ): Promise<BeforeLLMRequestDispatchResult> {
    let blockResult: BeforeLLMRequestDispatchResult | undefined;

    await this.forEachPluginHook('beforeLLMRequest', async (hookFn) => {
      const result = await hookFn(payload);
      if (result.action === 'block') {
        blockResult = { blocked: true, reason: result.reason };
        return true;
      }
    });

    return blockResult ?? { blocked: false };
  }

  async dispatchBeforeToolCall(
    toolCall: HookPayloadToolCall
  ): Promise<BeforeToolCallDispatchResult> {
    let shortCircuitResult: BeforeToolCallDispatchResult | undefined;

    await this.forEachPluginHook('beforeToolCall', async (hookFn) => {
      const result = await hookFn(toolCall);
      if (result.action !== 'continue') {
        shortCircuitResult = { shortCircuited: true, result: result.result };
        return true;
      }
    });

    return shortCircuitResult ?? { shortCircuited: false };
  }

  async dispatchAfterToolCall(
    payload: HookPayloadAfterToolCall
  ): Promise<HookPayloadAfterToolCall['result']> {
    let result = payload.result;

    await this.forEachPluginHook('afterToolCall', async (hookFn) => {
      const hookResult = await hookFn({ toolCall: payload.toolCall, result });
      result = hookResult.value;
    });

    return result;
  }

  async dispatchMessageSend(
    payload: HookPayloadMessageSend
  ): Promise<MessageSendDispatchResult> {
    let message = payload.message;
    let blockResult: MessageSendDispatchResult | undefined;

    await this.forEachPluginHook('onMessageSend', async (hookFn) => {
      const result = await hookFn({ message });
      if (result.action === 'block') {
        blockResult = { blocked: true, reason: result.reason };
        return true;
      }
      message = result.value;
    });

    return blockResult ?? { blocked: false, message };
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
      throw error;
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

      pluginInfo = this.findPluginInDirectoryScan(pluginName);

      if (!pluginInfo) {
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
      const existingConfig = this.getConfiguredPlugin(pluginName);
      const options = existingConfig?.options || {};

      await this.loadPluginFromEntry(
        {
          dir: pluginDir,
          packageJson,
          pluginName,
        },
        options,
        false
      );

      if (!this.loadedPlugins.has(pluginName)) {
        return {
          success: false,
          message: `插件 "${pluginName}" 加载失败`,
        };
      }

      const loadedPlugin = this.loadedPlugins.get(pluginName);
      const persistedOptions = loadedPlugin ? this.mergePluginOptions(loadedPlugin, options) : options;

      await this.persistPluginConfig(pluginName, true, persistedOptions);

      logger.info({ pluginName: pluginName }, 'Plugin enabled successfully');
      return {
        success: true,
        message: `插件 "${pluginName}" 已开启`,
      };
    } catch (error) {
      if (this.loadedPlugins.has(pluginName)) {
        try {
          await this.unloadPlugin(pluginName);
        } catch (rollbackError) {
          logger.error({ pluginName, error: rollbackError }, 'Failed to rollback plugin after enable error');
        }
      }
      logger.error({ pluginName: pluginName, error }, 'Failed to enable plugin');
      return {
        success: false,
        message: `插件 "${pluginName}" 开启失败: ${toErrorMessage(error)}`,
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

    const existingConfig = this.getConfiguredPlugin(pluginName);
    const options = existingConfig?.options || {};

    try {
      await this.persistPluginConfig(pluginName, false);
      await this.unloadPlugin(pluginName);

      logger.info({ pluginName: pluginName }, 'Plugin disabled successfully');
      return {
        success: true,
        message: `插件 "${pluginName}" 已关闭`,
      };
    } catch (error) {
      if (this.loadedPlugins.has(pluginName)) {
        try {
          await this.persistPluginConfig(pluginName, true, options);
        } catch (rollbackError) {
          logger.error({ pluginName, error: rollbackError }, 'Failed to rollback plugin config after disable error');
        }
      }
      logger.error({ pluginName: pluginName, error }, 'Failed to disable plugin');
      return {
        success: false,
        message: `插件 "${pluginName}" 关闭失败: ${toErrorMessage(error)}`,
      };
    }
  }

  getLoadedPlugins(): PluginInfo[] {
    return Array.from(this.pluginInfos.values());
  }

  shutdown(): void {
    logger.info({}, 'Shutting down PluginManager');

    for (const [name, plugin] of this.loadedPlugins.entries()) {
      if (plugin.commands && plugin.commands.length > 0) {
        this.deps.commandRegistrar.unregisterFromPlugin(name);
      }

      if (plugin.destroy) {
        plugin.destroy().catch((err) => {
          logger.error({ pluginName: name, error: err }, 'Plugin destroy failed');
        });
      }
    }

    this.loadedPlugins.clear();
    this.pluginInfos.clear();
    this.pluginPaths.clear();
    this.initialized = false;
  }

  getPluginCount(): number {
    return this.loadedPlugins.size;
  }
}
