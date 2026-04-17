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
import { assertPackageNameMatchesExportedName } from '@/platform/utils/package-manifest.js';
import { discoverPluginsByPrefix, type DiscoveredPlugin } from '@/platform/utils/plugin-discovery.js';
import {
  BeforeLLMRequestDispatchResult,
  BeforeToolCallDispatchResult,
  MessageReceiveDispatchResult,
  MessageSendDispatchResult,
  IPlugin,
  PluginContext,
  PluginInfo,
  PluginHooks,
  PluginLogger,
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

const LOG_LEVELS = ['info', 'warn', 'error', 'debug'] as const;

export class PluginManager {
  private toolRegistry: ToolRegistry;
  private deps: PluginManagerDependencies;
  private loadedPlugins: Map<string, IPlugin> = new Map();
  private initialized: boolean = false;
  private pluginsDir: string;
  private discovered: Map<string, DiscoveredPlugin> = new Map();

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

    this.rediscoverPlugins();
    logger.info({ found: this.discovered.size }, 'Found plugin directories');

    for (const info of this.discovered.values()) {
      const config = enabledPlugins.find(p => p.name === info.name || p.name === info.dirName);
      if (config && !config.enabled) {
        logger.info({ pluginName: info.name }, 'Plugin disabled in config, skipping');
        continue;
      }

      await this.loadPluginEntry(info, config?.options || {});
    }

    logger.info({ loaded: this.loadedPlugins.size }, 'Plugin scanning and loading completed');
  }

  private rediscoverPlugins(): void {
    this.discovered.clear();
    for (const found of discoverPluginsByPrefix(this.pluginsDir, 'plugin_')) {
      this.discovered.set(found.name, found);
    }
  }

  private resolveEntryCandidates(info: DiscoveredPlugin): string[] {
    const mainFile = info.packageJson.main || 'dist/index.js';
    return [
      path.join(info.dir, mainFile),
      path.join(info.dir, 'src/index.ts'),
    ];
  }

  private async loadPluginEntry(
    info: DiscoveredPlugin,
    options: Record<string, unknown>,
    registerDefaults = true
  ): Promise<void> {
    const candidates = this.resolveEntryCandidates(info);
    const entryPath = candidates.find(fs.existsSync);

    if (!entryPath) {
      logger.warn({ pluginName: info.name, candidates }, 'Plugin entry point not found');
      return;
    }

    try {
      const mod = await import(normalizeImportPath(entryPath));
      const plugin: IPlugin | undefined = mod.default || mod;

      if (!plugin || !plugin.name) {
        logger.warn({ entryPath }, 'Invalid plugin module, missing name');
        return;
      }

      assertPackageNameMatchesExportedName(info.packageJson, plugin.name, 'Plugin');
      await this.initializePlugin(plugin, options, registerDefaults);
    } catch (error) {
      logger.error({ entryPath, error: toErrorMessage(error) }, 'Failed to load plugin');
    }
  }

  private createPluginLogger(pluginName: string): PluginLogger {
    const make = (level: (typeof LOG_LEVELS)[number]) =>
      (msg: string, data?: Record<string, unknown>) =>
        logger[level]({ plugin: pluginName, ...data }, `[${pluginName}] ${msg}`);
    return {
      info: make('info'),
      warn: make('warn'),
      error: make('error'),
      debug: make('debug'),
    };
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

    logger.info({ pluginName: plugin.name, version: plugin.version }, 'Loading plugin');

    const mergedOptions = this.mergePluginOptions(plugin, options);

    const context: PluginContext = {
      logger: this.createPluginLogger(plugin.name),
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
    const plugins = this.deps.configStore.config.plugins;
    let matched = false;
    const next = plugins.map((plugin) => {
      if (plugin.name !== pluginName) {
        return { ...plugin, options: plugin.options ? { ...plugin.options } : {} };
      }
      matched = true;
      return {
        ...plugin,
        enabled,
        options: options ?? (plugin.options ? { ...plugin.options } : {}),
      };
    });

    if (!matched) {
      next.push({ name: pluginName, enabled, options: options || {} });
    }
    return next;
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

      logger.info({ pluginName }, 'Plugin unloaded successfully');
    } catch (error) {
      logger.error({ pluginName, error }, 'Plugin unload failed');
      throw error;
    }
  }

  async enablePlugin(pluginName: string): Promise<{ success: boolean; message: string }> {
    if (this.loadedPlugins.has(pluginName)) {
      return { success: false, message: `插件 "${pluginName}" 已经加载` };
    }

    if (!fs.existsSync(this.pluginsDir)) {
      return { success: false, message: `未找到插件 "${pluginName}"，插件目录不存在` };
    }

    let info = this.discovered.get(pluginName);
    if (!info) {
      this.rediscoverPlugins();
      info = this.discovered.get(pluginName);
    }

    if (!info) {
      return {
        success: false,
        message: `未找到插件 "${pluginName}"，请确认插件已存在于 plugins/ 目录`,
      };
    }

    try {
      const existingConfig = this.getConfiguredPlugin(pluginName);
      const options = existingConfig?.options || {};

      await this.loadPluginEntry(info, options, false);

      if (!this.loadedPlugins.has(pluginName)) {
        return { success: false, message: `插件 "${pluginName}" 加载失败` };
      }

      const loadedPlugin = this.loadedPlugins.get(pluginName);
      const persistedOptions = loadedPlugin ? this.mergePluginOptions(loadedPlugin, options) : options;

      await this.persistPluginConfig(pluginName, true, persistedOptions);

      logger.info({ pluginName }, 'Plugin enabled successfully');
      return { success: true, message: `插件 "${pluginName}" 已开启` };
    } catch (error) {
      if (this.loadedPlugins.has(pluginName)) {
        try {
          await this.unloadPlugin(pluginName);
        } catch (rollbackError) {
          logger.error({ pluginName, error: rollbackError }, 'Failed to rollback plugin after enable error');
        }
      }
      logger.error({ pluginName, error }, 'Failed to enable plugin');
      return {
        success: false,
        message: `插件 "${pluginName}" 开启失败: ${toErrorMessage(error)}`,
      };
    }
  }

  async disablePlugin(pluginName: string): Promise<{ success: boolean; message: string }> {
    if (!this.loadedPlugins.has(pluginName)) {
      return { success: false, message: `插件 "${pluginName}" 未加载或不存在` };
    }

    const existingConfig = this.getConfiguredPlugin(pluginName);
    const options = existingConfig?.options || {};

    try {
      await this.persistPluginConfig(pluginName, false);
      await this.unloadPlugin(pluginName);

      logger.info({ pluginName }, 'Plugin disabled successfully');
      return { success: true, message: `插件 "${pluginName}" 已关闭` };
    } catch (error) {
      if (this.loadedPlugins.has(pluginName)) {
        try {
          await this.persistPluginConfig(pluginName, true, options);
        } catch (rollbackError) {
          logger.error({ pluginName, error: rollbackError }, 'Failed to rollback plugin config after disable error');
        }
      }
      logger.error({ pluginName, error }, 'Failed to disable plugin');
      return {
        success: false,
        message: `插件 "${pluginName}" 关闭失败: ${toErrorMessage(error)}`,
      };
    }
  }

  getLoadedPlugins(): PluginInfo[] {
    return Array.from(this.loadedPlugins.values(), plugin => ({
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      loaded: true,
      hooks: Object.keys(plugin.hooks ?? {}),
      commands: plugin.commands?.length || 0,
    }));
  }

  async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down PluginManager');

    const destroyPromises: Promise<void>[] = [];

    for (const [name, plugin] of this.loadedPlugins.entries()) {
      if (plugin.commands && plugin.commands.length > 0) {
        this.deps.commandRegistrar.unregisterFromPlugin(name);
      }

      if (plugin.destroy) {
        destroyPromises.push(
          plugin.destroy().catch((err) => {
            logger.error({ pluginName: name, error: err }, 'Plugin destroy failed');
          })
        );
      }
    }

    await Promise.allSettled(destroyPromises);

    this.loadedPlugins.clear();
    this.discovered.clear();
    this.initialized = false;
  }

  getPluginCount(): number {
    return this.loadedPlugins.size;
  }
}
