import * as fs from 'fs';
import * as path from 'path';
import type { PluginConfigStore, PluginRuntimeConfig } from '@/contracts/commands.js';
import type { CommandManager } from '@/platform/commands/command-manager.js';
import { createRegistrationOwner } from '@/platform/registration/types.js';
import { logger, createScopedLogger } from '@/platform/observability/logger.js';
import type { ToolManager } from '@/platform/tools/registry.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { hasCanonicalValueChanged } from '@/platform/utils/canonical-stringify.js';
import { loadDiscoveredModule } from '@/platform/utils/discovered-module-loader.js';
import { mergeDefaultOptions } from '@/platform/utils/merge-default-options.js';
import { discoverPluginsByPrefix, type DiscoveredPlugin } from '@/platform/utils/plugin-discovery.js';
import {
  BeforeLLMRequestDispatchResult,
  BeforeToolCallDispatchResult,
  ReceiveDispatchResult,
  SendDispatchResult,
  Plugin,
  PluginContext,
  PluginInfo,
  PluginHooks,
  HookPayloadReceive,
  HookPayloadBeforeLLMRequest,
  HookPayloadToolCall,
  HookPayloadAfterToolCall,
  HookPayloadSend,
} from './types.js';

export interface PluginManagerDependencies {
  commandManager: CommandManager;
  toolManager: ToolManager;
  configStore: PluginConfigStore;
}

interface LoadedPluginRecord {
  plugin: Plugin;
  aliases: Set<string>;
  commandScope: ReturnType<CommandManager['createScope']>;
  toolScope: ReturnType<ToolManager['createScope']>;
}

export class PluginManager {
  private deps: PluginManagerDependencies;
  private loadedPlugins: Map<string, LoadedPluginRecord> = new Map();
  private aliasToPluginName: Map<string, string> = new Map();
  private initialized = false;
  private readonly pluginsDir: string;
  private discovered: Map<string, DiscoveredPlugin> = new Map();
  private configChangeUnsubscribe: (() => void) | null = null;
  private hotReloadEnabled = false;
  private suspendedConfigReloads = 0;

  constructor(deps: PluginManagerDependencies) {
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

    const uniquePlugins = [...new Set(this.discovered.values())];
    for (const info of uniquePlugins) {
      const config = enabledPlugins.find(p => p.name === info.name || p.name === info.dirName);
      if (config && !config.enabled) {
        logger.info({ pluginName: info.name }, 'Plugin disabled in config, skipping');
        continue;
      }

      await this.loadPluginEntry(info, config?.options || {});
    }

    logger.info({ loaded: this.loadedPlugins.size }, 'Plugin scanning and loading completed');
  }

  watchConfigChanges(): void {
    this.registerConfigChangeListener();
  }

  private rediscoverPlugins(): void {
    this.discovered.clear();
    for (const found of discoverPluginsByPrefix(this.pluginsDir, 'plugin_')) {
      this.discovered.set(found.name, found);
      this.discovered.set(found.dirName, found);
    }
  }

  private resolvePluginName(name: string): string | undefined {
    return this.aliasToPluginName.get(name) ?? (this.loadedPlugins.has(name) ? name : undefined);
  }

  private findDiscoveredPlugin(name: string): DiscoveredPlugin | undefined {
    let info = this.discovered.get(name);
    if (!info) {
      this.rediscoverPlugins();
      info = this.discovered.get(name);
    }

    return info;
  }

  private getStoredPluginConfig(...names: string[]): PluginRuntimeConfig | undefined {
    for (const name of names) {
      const config = this.deps.configStore.getPluginRuntimeConfig(name);
      if (config) {
        return config;
      }
    }

    return undefined;
  }

  private createPluginLogger(pluginName: string) {
    return createScopedLogger(pluginName, 'plugin');
  }

  private setPluginAliases(pluginName: string, aliases: Iterable<string>): void {
    for (const alias of aliases) {
      this.aliasToPluginName.set(alias, pluginName);
    }
  }

  private removePluginAliases(pluginName: string, aliases: Iterable<string>): void {
    for (const alias of aliases) {
      if (this.aliasToPluginName.get(alias) === pluginName) {
        this.aliasToPluginName.delete(alias);
      }
    }
  }

  private disposePluginScopes(record: Pick<LoadedPluginRecord, 'commandScope' | 'toolScope'>): void {
    record.commandScope.dispose();
    record.toolScope.dispose();
  }

  private async loadPluginEntry(
    info: DiscoveredPlugin,
    options: Record<string, unknown>,
    registerDefaults = true
  ): Promise<void> {
    try {
      const loaded = await loadDiscoveredModule<Plugin>(info, 'Plugin');
      if (!loaded.entryPath || !loaded.module) {
        logger.warn({ pluginName: info.name, candidates: loaded.candidates }, 'Plugin entry point not found');
        return;
      }

      await this.initializePlugin(loaded.module, info, options, registerDefaults);
    } catch (error) {
      logger.error({ pluginName: info.name, error: toErrorMessage(error) }, 'Failed to load plugin');
    }
  }

  private async initializePlugin(
    plugin: Plugin,
    discovered: DiscoveredPlugin,
    options: Record<string, unknown>,
    registerDefaults = true
  ): Promise<void> {
    if (this.loadedPlugins.has(plugin.name)) {
      logger.warn({ pluginName: plugin.name }, 'Plugin already loaded, skipping');
      return;
    }

    logger.info({ pluginName: plugin.name, version: plugin.version }, 'Loading plugin');

    const mergedOptions = this.mergePluginOptions(plugin, options);
    const owner = createRegistrationOwner('plugin', plugin.name);
    const commandScope = this.deps.commandManager.createScope(owner, { namespace: plugin.name });
    const toolScope = this.deps.toolManager.createScope(owner);

    const context: PluginContext = {
      logger: this.createPluginLogger(plugin.name),
      config: mergedOptions,
      tools: toolScope,
      commands: commandScope,
    };

    try {
      if (plugin.init) {
        await plugin.init(context);
      }

      this.loadedPlugins.set(plugin.name, {
        plugin,
        aliases: new Set([plugin.name, discovered.name, discovered.dirName]),
        commandScope,
        toolScope,
      });

      this.setPluginAliases(plugin.name, [plugin.name, discovered.name, discovered.dirName]);

      if (registerDefaults && plugin.defaultOptions !== undefined) {
        this.deps.configStore.registerDefaults('plugin', plugin.name, plugin.defaultOptions);
      }

      logger.info({ pluginName: plugin.name }, 'Plugin loaded successfully');
    } catch (error) {
      const cleanupErrors: unknown[] = [];

      try {
        this.disposePluginScopes({ commandScope, toolScope });
      } catch (disposeError) {
        logger.error({ pluginName: plugin.name, error: disposeError }, 'Plugin scope cleanup after initialization failure failed');
        cleanupErrors.push(disposeError);
      }

      try {
        if (plugin.destroy) {
          await plugin.destroy();
        }
      } catch (cleanupError) {
        logger.error({ pluginName: plugin.name, error: cleanupError }, 'Plugin cleanup after initialization failure failed');
        cleanupErrors.push(cleanupError);
      }

      logger.error({ pluginName: plugin.name, error }, 'Plugin initialization failed');

      if (cleanupErrors.length === 1) {
        throw new AggregateError([cleanupErrors[0]], `Plugin "${plugin.name}" initialization cleanup failed`, { cause: error });
      }

      if (cleanupErrors.length > 1) {
        throw new AggregateError(cleanupErrors, `Plugin "${plugin.name}" initialization cleanup failed`, { cause: error });
      }
    }
  }

  private mergePluginOptions(
    plugin: Plugin,
    userOptions: Record<string, unknown>
  ): Record<string, unknown> {
    return mergeDefaultOptions(plugin.defaultOptions || {}, userOptions);
  }

  private async persistPluginConfig(
    pluginName: string,
    enabled: boolean,
    options?: Record<string, unknown>
  ): Promise<void> {
    const updated = await this.runWithConfigReloadSuspended(() =>
      this.deps.configStore.updatePluginRuntimeConfig(pluginName, { enabled, options })
    );
    if (!updated) {
      throw new Error(`Failed to persist plugin config for "${pluginName}"`);
    }
  }

  private async runWithConfigReloadSuspended<T>(action: () => Promise<T>): Promise<T> {
    this.suspendedConfigReloads += 1;
    try {
      return await action();
    } finally {
      this.suspendedConfigReloads -= 1;
    }
  }

  private async unloadAllPlugins(): Promise<void> {
    const names = Array.from(this.loadedPlugins.keys());
    const shutdownErrors: unknown[] = [];

    for (const name of names) {
      try {
        await this.unloadPlugin(name);
      } catch (error) {
        logger.error({ pluginName: name, error }, 'Plugin shutdown unload failed');
        shutdownErrors.push(error);
      }
    }

    if (shutdownErrors.length === 1) {
      throw shutdownErrors[0];
    }

    if (shutdownErrors.length > 1) {
      throw new AggregateError(shutdownErrors, 'One or more plugins failed to shut down cleanly');
    }
  }

  private registerConfigChangeListener(): void {
    this.configChangeUnsubscribe?.();
    this.configChangeUnsubscribe = null;
    this.hotReloadEnabled = false;

    this.configChangeUnsubscribe = this.deps.configStore.onPluginConfigChange(async (nextPlugins, previousPlugins) => {
      if (!this.hotReloadEnabled || this.suspendedConfigReloads > 0) {
        return;
      }
      if (!hasCanonicalValueChanged(previousPlugins, nextPlugins)) {
        return;
      }

      logger.info({}, 'Plugin config changed, reloading plugins');
      this.hotReloadEnabled = false;
      try {
        await this.unloadAllPlugins();
        await this.scanAndLoad(nextPlugins);
        await this.runWithConfigReloadSuspended(() => this.deps.configStore.syncAllDefaultConfigs());
      } catch (error) {
        logger.error({ error }, 'Plugin config reload failed');
        throw error;
      } finally {
        this.hotReloadEnabled = true;
      }
    });

    this.hotReloadEnabled = true;
  }

  private async forEachPluginHook<K extends keyof PluginHooks>(
    hookName: K,
    callback: (plugin: Plugin, hookFn: NonNullable<PluginHooks[K]>) => Promise<boolean | void>
  ): Promise<void> {
    for (const { plugin } of this.loadedPlugins.values()) {
      const hookFn = plugin.hooks?.[hookName];
      if (!hookFn) continue;
      try {
        logger.debug({ pluginName: plugin.name, hookName }, 'Dispatching hook');
        if (await callback(plugin, hookFn)) return;
      } catch (error) {
        logger.error({ pluginName: plugin.name, hookName, error }, 'Hook execution failed');
      }
    }
  }

  private async dispatchMessageHook<TMessage>(
    hookName: 'onReceive' | 'onSend',
    initialMessage: TMessage
  ): Promise<{ blocked: true; reason?: string } | { blocked: false; message: TMessage }> {
    let message = initialMessage;
    let blockResult: { blocked: true; reason?: string } | undefined;

    await this.forEachPluginHook(hookName, async (_plugin, hookFn) => {
      const result = await (
        hookFn as (_payload: { message: TMessage }) => Promise<
          | { action: 'block'; reason?: string }
          | { action: 'continue'; value: TMessage }
        >
      )({ message });

      if (result.action === 'block') {
        blockResult = { blocked: true, reason: result.reason };
        return true;
      }

      message = result.value;
    });

    return blockResult ?? { blocked: false, message };
  }

  async dispatchReceive(
    payload: HookPayloadReceive
  ): Promise<ReceiveDispatchResult> {
    return this.dispatchMessageHook('onReceive', payload.message);
  }

  async dispatchBeforeLLMRequest(
    payload: HookPayloadBeforeLLMRequest
  ): Promise<BeforeLLMRequestDispatchResult> {
    let blockResult: BeforeLLMRequestDispatchResult | undefined;

    await this.forEachPluginHook('beforeLLMRequest', async (_plugin, hookFn) => {
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

    await this.forEachPluginHook('beforeToolCall', async (_plugin, hookFn) => {
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

    await this.forEachPluginHook('afterToolCall', async (_plugin, hookFn) => {
      const hookResult = await hookFn({ toolCall: payload.toolCall, result });
      result = hookResult.value;
    });

    return result;
  }

  async dispatchSend(
    payload: HookPayloadSend
  ): Promise<SendDispatchResult> {
    return this.dispatchMessageHook('onSend', payload.message);
  }

  async unloadPlugin(pluginNameOrAlias: string): Promise<void> {
    const pluginName = this.resolvePluginName(pluginNameOrAlias) ?? pluginNameOrAlias;
    const record = this.loadedPlugins.get(pluginName);
    if (!record) {
      logger.warn({ pluginName: pluginNameOrAlias }, 'Plugin not loaded, skipping unload');
      return;
    }

    const cleanupErrors: unknown[] = [];

    try {
      if (record.plugin.destroy) {
        await record.plugin.destroy();
      }
    } catch (error) {
      logger.error({ pluginName, error }, 'Plugin unload cleanup failed');
      cleanupErrors.push(error);
    }

    try {
      this.disposePluginScopes(record);
    } catch (error) {
      logger.error({ pluginName, error }, 'Plugin scope disposal failed during unload');
      cleanupErrors.push(error);
    } finally {
      this.loadedPlugins.delete(pluginName);
      this.removePluginAliases(pluginName, record.aliases);
    }

    if (cleanupErrors.length === 1) {
      throw cleanupErrors[0];
    }

    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, `Plugin "${pluginName}" unload failed`);
    }

    logger.info({ pluginName }, 'Plugin unloaded successfully');
  }

  async enablePlugin(pluginNameOrAlias: string): Promise<{ success: boolean; message: string }> {
    const resolvedLoadedName = this.resolvePluginName(pluginNameOrAlias);
    if (resolvedLoadedName && this.loadedPlugins.has(resolvedLoadedName)) {
      return { success: false, message: `插件 "${pluginNameOrAlias}" 已经加载` };
    }

    if (!fs.existsSync(this.pluginsDir)) {
      return { success: false, message: `未找到插件 "${pluginNameOrAlias}"，插件目录不存在` };
    }

    const info = this.findDiscoveredPlugin(pluginNameOrAlias);

    if (!info) {
      return {
        success: false,
        message: `未找到插件 "${pluginNameOrAlias}"，请确认插件已存在于 plugins/ 目录`,
      };
    }

    try {
      const existingConfig = this.getStoredPluginConfig(info.name, info.dirName, pluginNameOrAlias);
      const options = existingConfig?.options || {};

      await this.loadPluginEntry(info, options, false);

      const loadedPluginName = this.resolvePluginName(info.name) ?? this.resolvePluginName(info.dirName) ?? info.name;
      const loadedRecord = this.loadedPlugins.get(loadedPluginName);
      if (!loadedRecord) {
        return { success: false, message: `插件 "${pluginNameOrAlias}" 加载失败` };
      }

      const persistedOptions = this.mergePluginOptions(loadedRecord.plugin, options);
      await this.persistPluginConfig(loadedRecord.plugin.name, true, persistedOptions);

      logger.info({ pluginName: loadedRecord.plugin.name }, 'Plugin enabled successfully');
      return { success: true, message: `插件 "${loadedRecord.plugin.name}" 已开启` };
    } catch (error) {
      const loadedName = this.resolvePluginName(pluginNameOrAlias);
      if (loadedName && this.loadedPlugins.has(loadedName)) {
        try {
          await this.unloadPlugin(loadedName);
        } catch (rollbackError) {
          logger.error({ pluginName: loadedName, error: rollbackError }, 'Failed to rollback plugin after enable error');
        }
      }

      logger.error({ pluginName: pluginNameOrAlias, error }, 'Failed to enable plugin');
      return {
        success: false,
        message: `插件 "${pluginNameOrAlias}" 开启失败: ${toErrorMessage(error)}`,
      };
    }
  }

  async disablePlugin(pluginNameOrAlias: string): Promise<{ success: boolean; message: string }> {
    const pluginName = this.resolvePluginName(pluginNameOrAlias);
    if (!pluginName || !this.loadedPlugins.has(pluginName)) {
      return { success: false, message: `插件 "${pluginNameOrAlias}" 未加载或不存在` };
    }

    const existingConfig = this.deps.configStore.getPluginRuntimeConfig(pluginName);
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
    return Array.from(this.loadedPlugins.values(), ({ plugin, commandScope }) => ({
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      loaded: true,
      hooks: Object.keys(plugin.hooks ?? {}),
      commands: commandScope.listOwnedNames().length,
    }));
  }

  async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down PluginManager');

    this.configChangeUnsubscribe?.();
    this.configChangeUnsubscribe = null;
    this.hotReloadEnabled = false;

    await this.unloadAllPlugins();

    this.discovered.clear();
    this.initialized = false;
  }

  getPluginCount(): number {
    return this.loadedPlugins.size;
  }

}
