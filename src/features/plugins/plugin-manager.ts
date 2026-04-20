/** @file 插件管理器
 *
 * PluginManager 是插件系统的核心，负责：
 * - 扫描与加载 plugin_* 目录下的插件模块
 * - 管理插件生命周期（init/destroy）与注册作用域（工具/命令）
 * - 维护插件别名映射（支持通过目录名或插件名引用）
 * - 实现 PluginHookRuntime 接口，分发钩子调用
 * - 支持配置热重载：监听插件配置变更，卸载全部插件后重新加载
 * - 提供启用/禁用插件的运行时操作（含配置持久化与回滚）
 *
 * 钩子分发策略：按插件加载顺序依次调用，任一插件返回
 * block/shortCircuit 即终止后续插件的分发。
 */

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
import {
    discoverPluginsByPrefix,
    type DiscoveredPlugin,
} from '@/platform/utils/plugin-discovery.js';
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

/** PluginManager 的依赖注入接口 */
export interface PluginManagerDependencies {
    commandManager: CommandManager;
    toolManager: ToolManager;
    configStore: PluginConfigStore;
}

/** 已加载插件的记录，包含插件实例、别名集与注册作用域 */
interface LoadedPluginRecord {
    plugin: Plugin;
    aliases: Set<string>;
    commandScope: ReturnType<CommandManager['createScope']>;
    toolScope: ReturnType<ToolManager['createScope']>;
}

/** 插件管理器
 *
 * 管理插件的加载、卸载、钩子分发与配置热重载。
 * 同时实现 PluginHookRuntime 接口，供 Pipeline 在消息生命周期各阶段调用。
 */
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

    /** 初始化插件管理器（仅标记为已初始化） */
    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.warn({}, 'PluginManager already initialized');
            return;
        }

        logger.info({}, 'Initializing PluginManager...');
        this.initialized = true;
    }

    /** 扫描插件目录并加载所有已启用的插件 */
    async scanAndLoad(enabledPlugins: readonly PluginRuntimeConfig[]): Promise<void> {
        logger.info({ pluginsDir: this.pluginsDir }, 'Scanning plugins directory');

        if (!fs.existsSync(this.pluginsDir)) {
            logger.warn(
                { pluginsDir: this.pluginsDir },
                'Plugins directory does not exist, creating...',
            );
            fs.mkdirSync(this.pluginsDir, { recursive: true });
            return;
        }

        this.rediscoverPlugins();
        logger.info({ found: this.discovered.size }, 'Found plugin directories');

        const uniquePlugins = [...new Set(this.discovered.values())];
        for (const info of uniquePlugins) {
            const config = enabledPlugins.find(
                (p) => p.name === info.name || p.name === info.dirName,
            );
            if (config && !config.enabled) {
                logger.info({ pluginName: info.name }, 'Plugin disabled in config, skipping');
                continue;
            }

            await this.loadPluginEntry(info, config?.options || {});
        }

        logger.info({ loaded: this.loadedPlugins.size }, 'Plugin scanning and loading completed');
    }

    /** 启用配置变更热重载监听 */
    watchConfigChanges(): void {
        this.registerConfigChangeListener();
    }

    /** 重新扫描 plugin_* 目录，更新已发现插件映射（支持通过目录名和插件名双向查找） */
    private rediscoverPlugins(): void {
        this.discovered.clear();
        for (const found of discoverPluginsByPrefix(this.pluginsDir, 'plugin_')) {
            this.discovered.set(found.name, found);
            this.discovered.set(found.dirName, found);
        }
    }

    /** 通过名称或别名解析出规范插件名 */
    private resolvePluginName(name: string): string | undefined {
        return (
            this.aliasToPluginName.get(name) ?? (this.loadedPlugins.has(name) ? name : undefined)
        );
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

    private disposePluginScopes(
        record: Pick<LoadedPluginRecord, 'commandScope' | 'toolScope'>,
    ): void {
        record.commandScope.dispose();
        record.toolScope.dispose();
    }

    private async loadPluginEntry(
        info: DiscoveredPlugin,
        options: Record<string, unknown>,
        registerDefaults = true,
    ): Promise<void> {
        try {
            const loaded = await loadDiscoveredModule<Plugin>(info, 'Plugin');
            if (!loaded.entryPath || !loaded.module) {
                logger.warn(
                    { pluginName: info.name, candidates: loaded.candidates },
                    'Plugin entry point not found',
                );
                return;
            }

            await this.initializePlugin(loaded.module, info, options, registerDefaults);
        } catch (error) {
            logger.error(
                { pluginName: info.name, error: toErrorMessage(error) },
                'Failed to load plugin',
            );
        }
    }

    private async initializePlugin(
        plugin: Plugin,
        discovered: DiscoveredPlugin,
        options: Record<string, unknown>,
        registerDefaults = true,
    ): Promise<void> {
        if (this.loadedPlugins.has(plugin.name)) {
            logger.warn({ pluginName: plugin.name }, 'Plugin already loaded, skipping');
            return;
        }

        logger.info({ pluginName: plugin.name, version: plugin.version }, 'Loading plugin');

        const mergedOptions = this.mergePluginOptions(plugin, options);
        const owner = createRegistrationOwner('plugin', plugin.name);
        const commandScope = this.deps.commandManager.createScope(owner, {
            namespace: plugin.name,
        });
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
                this.deps.configStore.registerDefaults(
                    'plugin',
                    plugin.name,
                    plugin.defaultOptions,
                );
            }

            logger.info({ pluginName: plugin.name }, 'Plugin loaded successfully');
        } catch (error) {
            const cleanupErrors: unknown[] = [];

            try {
                this.disposePluginScopes({ commandScope, toolScope });
            } catch (disposeError) {
                logger.error(
                    { pluginName: plugin.name, error: disposeError },
                    'Plugin scope cleanup after initialization failure failed',
                );
                cleanupErrors.push(disposeError);
            }

            try {
                if (plugin.destroy) {
                    await plugin.destroy();
                }
            } catch (cleanupError) {
                logger.error(
                    { pluginName: plugin.name, error: cleanupError },
                    'Plugin cleanup after initialization failure failed',
                );
                cleanupErrors.push(cleanupError);
            }

            logger.error({ pluginName: plugin.name, error }, 'Plugin initialization failed');

            if (cleanupErrors.length === 1) {
                throw new AggregateError(
                    [cleanupErrors[0]],
                    `Plugin "${plugin.name}" initialization cleanup failed`,
                    { cause: error },
                );
            }

            if (cleanupErrors.length > 1) {
                throw new AggregateError(
                    cleanupErrors,
                    `Plugin "${plugin.name}" initialization cleanup failed`,
                    { cause: error },
                );
            }
        }
    }

    private mergePluginOptions(
        plugin: Plugin,
        userOptions: Record<string, unknown>,
    ): Record<string, unknown> {
        return mergeDefaultOptions(plugin.defaultOptions || {}, userOptions);
    }

    /** 持久化插件配置到配置文件
     *
     * 使用 runWithConfigReloadSuspended 包裹，防止持久化操作触发热重载。
     * 优先使用已存储配置中的规范名称（可能是别名），确保配置一致性。
     */
    private async persistPluginConfig(
        pluginName: string,
        enabled: boolean,
        options?: Record<string, unknown>,
    ): Promise<boolean> {
        const record = this.loadedPlugins.get(pluginName);
        const aliasNames = record ? Array.from(record.aliases) : [pluginName];

        const existingConfig = this.getStoredPluginConfig(...aliasNames);
        const canonicalName = existingConfig?.name ?? pluginName;

        const updated = await this.runWithConfigReloadSuspended(() =>
            this.deps.configStore.updatePluginRuntimeConfig(canonicalName, {
                enabled,
                options,
            }),
        );
        if (!updated) {
            throw new Error(`Failed to persist plugin config for "${canonicalName}"`);
        }
        return true;
    }

    /** 在操作期间暂停配置热重载
     *
     * 防止 enable/disable 等操作修改配置文件时，
     * 触发 onPluginConfigChange 导致插件被意外重载。
     * 通过计数器支持嵌套暂停。
     */
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
            throw new AggregateError(
                shutdownErrors,
                'One or more plugins failed to shut down cleanly',
            );
        }
    }

    /** 注册配置变更监听器
     *
     * 当插件配置的规范值发生变化时，卸载所有插件并重新加载。
     * 使用 hotReloadEnabled 标志控制：监听器注册后立即启用，
     * 重载期间禁用，防止递归触发。suspendedConfigReloads 计数器
     * 用于在 enable/disable 操作期间抑制重载。
     */
    private registerConfigChangeListener(): void {
        this.configChangeUnsubscribe?.();
        this.configChangeUnsubscribe = null;
        this.hotReloadEnabled = false;

        this.configChangeUnsubscribe = this.deps.configStore.onPluginConfigChange(
            async (nextPlugins, previousPlugins) => {
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
                    await this.runWithConfigReloadSuspended(() =>
                        this.deps.configStore.syncAllDefaultConfigs(),
                    );
                } catch (error) {
                    logger.error({ error }, 'Plugin config reload failed');
                    throw error;
                } finally {
                    this.hotReloadEnabled = true;
                }
            },
        );

        this.hotReloadEnabled = true;
    }

    /** 遍历所有已加载插件的指定钩子
     *
     * 按加载顺序调用，若任一回调返回 true 则终止遍历。
     * 单个插件钩子失败不影响其他插件的执行。
     */
    private async forEachPluginHook<K extends keyof PluginHooks>(
        hookName: K,
        callback: (plugin: Plugin, hookFn: NonNullable<PluginHooks[K]>) => Promise<boolean | void>,
    ): Promise<void> {
        for (const { plugin } of this.loadedPlugins.values()) {
            const hookFn = plugin.hooks?.[hookName];
            if (!hookFn) {
                continue;
            }
            try {
                logger.debug({ pluginName: plugin.name, hookName }, 'Dispatching hook');
                if (await callback(plugin, hookFn)) {
                    return;
                }
            } catch (error) {
                logger.error({ pluginName: plugin.name, hookName, error }, 'Hook execution failed');
            }
        }
    }

    /** 消息钩子通用分发器（onReceive / onSend）
     *
     * 按顺序调用各插件的钩子，支持消息修改与阻止。
     * 返回 block 时终止后续分发，返回 continue 时传递修改后的消息。
     */
    private async dispatchMessageHook<TMessage>(
        hookName: 'onReceive' | 'onSend',
        initialMessage: TMessage,
    ): Promise<{ blocked: true; reason?: string } | { blocked: false; message: TMessage }> {
        let message = initialMessage;
        let blockResult: { blocked: true; reason?: string } | undefined;

        await this.forEachPluginHook(hookName, async (_plugin, hookFn) => {
            const result = await (
                hookFn as (_payload: {
                    message: TMessage;
                }) => Promise<
                    { action: 'block'; reason?: string } | { action: 'continue'; value: TMessage }
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

    /** 分发 onReceive 钩子 */
    async dispatchReceive(payload: HookPayloadReceive): Promise<ReceiveDispatchResult> {
        return this.dispatchMessageHook('onReceive', payload.message);
    }

    /** 分发 beforeLLMRequest 钩子 */
    async dispatchBeforeLLMRequest(
        payload: HookPayloadBeforeLLMRequest,
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

    /** 分发 beforeToolCall 钩子 */
    async dispatchBeforeToolCall(
        toolCall: HookPayloadToolCall,
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

    /** 分发 afterToolCall 钩子 */
    async dispatchAfterToolCall(
        payload: HookPayloadAfterToolCall,
    ): Promise<HookPayloadAfterToolCall['result']> {
        let result = payload.result;

        await this.forEachPluginHook('afterToolCall', async (_plugin, hookFn) => {
            const hookResult = await hookFn({ toolCall: payload.toolCall, result });
            result = hookResult.value;
        });

        return result;
    }

    /** 分发 onSend 钩子 */
    async dispatchSend(payload: HookPayloadSend): Promise<SendDispatchResult> {
        return this.dispatchMessageHook('onSend', payload.message);
    }

    /** 卸载指定插件
     *
     * 先调用 destroy() 释放插件资源，再释放命令/工具注册作用域。
     * 两个步骤独立 try-catch，确保即使 destroy 失败也能清理注册作用域。
     */
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

    /** 启用插件
     *
     * 流程：发现 → 加载 → 持久化配置为 enabled。
     * 加载失败时自动回滚（卸载已加载的插件）。
     */
    async enablePlugin(pluginNameOrAlias: string): Promise<{ success: boolean; message: string }> {
        const resolvedLoadedName = this.resolvePluginName(pluginNameOrAlias);
        if (resolvedLoadedName && this.loadedPlugins.has(resolvedLoadedName)) {
            return {
                success: false,
                message: `插件 "${pluginNameOrAlias}" 已经加载`,
            };
        }

        if (!fs.existsSync(this.pluginsDir)) {
            return {
                success: false,
                message: `未找到插件 "${pluginNameOrAlias}"，插件目录不存在`,
            };
        }

        const info = this.findDiscoveredPlugin(pluginNameOrAlias);

        if (!info) {
            return {
                success: false,
                message: `未找到插件 "${pluginNameOrAlias}"，请确认插件已存在于 plugins/ 目录`,
            };
        }

        try {
            const existingConfig = this.getStoredPluginConfig(
                info.name,
                info.dirName,
                pluginNameOrAlias,
            );
            const options = existingConfig?.options || {};

            await this.loadPluginEntry(info, options, false);

            const loadedPluginName =
                this.resolvePluginName(info.name) ??
                this.resolvePluginName(info.dirName) ??
                info.name;
            const loadedRecord = this.loadedPlugins.get(loadedPluginName);
            if (!loadedRecord) {
                return {
                    success: false,
                    message: `插件 "${pluginNameOrAlias}" 加载失败`,
                };
            }

            const persistedOptions = this.mergePluginOptions(loadedRecord.plugin, options);
            await this.persistPluginConfig(loadedRecord.plugin.name, true, persistedOptions);

            logger.info({ pluginName: loadedRecord.plugin.name }, 'Plugin enabled successfully');
            return {
                success: true,
                message: `插件 "${loadedRecord.plugin.name}" 已开启`,
            };
        } catch (error) {
            const loadedName = this.resolvePluginName(pluginNameOrAlias);
            if (loadedName && this.loadedPlugins.has(loadedName)) {
                try {
                    await this.unloadPlugin(loadedName);
                } catch (rollbackError) {
                    logger.error(
                        { pluginName: loadedName, error: rollbackError },
                        'Failed to rollback plugin after enable error',
                    );
                }
            }

            logger.error({ pluginName: pluginNameOrAlias, error }, 'Failed to enable plugin');
            return {
                success: false,
                message: `插件 "${pluginNameOrAlias}" 开启失败: ${toErrorMessage(error)}`,
            };
        }
    }

    /** 禁用插件
     *
     * 流程：持久化配置为 disabled → 卸载。
     * 卸载失败时自动回滚（恢复配置为 enabled）。
     */
    async disablePlugin(pluginNameOrAlias: string): Promise<{ success: boolean; message: string }> {
        const pluginName = this.resolvePluginName(pluginNameOrAlias);
        if (!pluginName || !this.loadedPlugins.has(pluginName)) {
            return {
                success: false,
                message: `插件 "${pluginNameOrAlias}" 未加载或不存在`,
            };
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
                    logger.error(
                        { pluginName, error: rollbackError },
                        'Failed to rollback plugin config after disable error',
                    );
                }
            }

            logger.error({ pluginName, error }, 'Failed to disable plugin');
            return {
                success: false,
                message: `插件 "${pluginName}" 关闭失败: ${toErrorMessage(error)}`,
            };
        }
    }

    /** 获取所有已加载插件的摘要信息 */
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

    /** 关闭插件管理器
     *
     * 取消配置变更监听、禁用热重载、卸载所有插件。
     */
    async shutdown(): Promise<void> {
        logger.info({}, 'Shutting down PluginManager');

        this.configChangeUnsubscribe?.();
        this.configChangeUnsubscribe = null;
        this.hotReloadEnabled = false;

        await this.unloadAllPlugins();

        this.discovered.clear();
        this.initialized = false;
    }

    /** 获取当前已加载的插件数量 */
    getPluginCount(): number {
        return this.loadedPlugins.size;
    }
}
