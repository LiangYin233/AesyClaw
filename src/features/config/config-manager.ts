/** @file 配置管理器
 *
 * ConfigManager 基于 c12 实现热重载配置管理，职责包括：
 * - 从配置文件加载配置，支持层级合并（c12 的默认行为）
 * - 使用 Zod 验证配置结构，验证失败时尝试用默认值填充缺失字段
 * - 注册插件/频道的默认值，并在适当时机同步到配置文件
 * - 监听配置文件变更，触发配置重载与变更通知
 * - 提供 selfUpdating 守卫，防止写入配置文件时触发自身的热重载回调
 * - 管理配置变更监听器，通知各子系统配置已更新
 */

import * as fs from 'fs';
import * as path from 'path';
import { ZodError } from 'zod';
import type { ConfigDefaultsScope, PluginRuntimeConfig } from '@/contracts/commands.js';
import { logger } from '@/platform/observability/logger.js';
import { pathResolver } from '@/platform/utils/paths.js';
import { FullConfigSchema, DEFAULT_CONFIG, type FullConfig } from './schema.js';
import { ConfigStore } from './config-store.js';
import { loadConfig, watchConfig, type ResolvedConfig } from 'c12';
import { createDefu } from 'defu';
import { parseConfigFromRaw } from './config-parser.js';
import { mergeDefaultOptions } from '@/platform/utils/merge-default-options.js';
import { hasCanonicalValueChanged } from '@/platform/utils/canonical-stringify.js';

/** 自定义 defu 合并策略：数组字段直接替换而非合并 */
const mergeConfigUpdates = createDefu((object, key, currentValue) => {
    if (Array.isArray(currentValue)) {
        object[key] = currentValue;
        return true;
    }
    return false;
});

type ConfigChangeListener = (_next: FullConfig, _prev: FullConfig) => void | Promise<void>;

/** 默认值同步目标接口，由 ConfigManager 自身实现 */
interface ConfigDefaultsSyncTarget {
    readonly config: FullConfig;
    updateConfig(updates: Partial<FullConfig>): Promise<boolean>;
}

/** 默认值合并结果 */
interface MergedDefaultsResult {
    merged: Record<string, unknown>;
    changed: boolean;
}

/** 默认值注册表
 *
 * 收集各插件/频道注册的默认值，在 sync() 时批量合并到配置文件。
 * 合并策略：使用 mergeDefaultOptions（递归合并，数组替换）。
 */
class ConfigDefaultsRegistry {
    private pendingDefaults: Record<ConfigDefaultsScope, Map<string, Record<string, unknown>>> = {
        plugin: new Map<string, Record<string, unknown>>(),
        channel: new Map<string, Record<string, unknown>>(),
    };

    register(scope: ConfigDefaultsScope, name: string, defaults: Record<string, unknown>): void {
        this.pendingDefaults[scope].set(name, defaults);
    }

    async sync(target: ConfigDefaultsSyncTarget): Promise<void> {
        await this.syncPluginDefaults(target);
        await this.syncChannelDefaults(target);
    }

    private async persistDefaultsUpdate(
        target: ConfigDefaultsSyncTarget,
        updates: Partial<FullConfig>,
        scope: ConfigDefaultsScope,
    ): Promise<void> {
        const updated = await target.updateConfig(updates);
        if (!updated) {
            throw new Error(`Failed to persist ${scope} defaults`);
        }
    }

    private mergeRegisteredDefaults(
        defaults: Record<string, unknown>,
        existing?: Record<string, unknown>,
    ): MergedDefaultsResult {
        const merged = mergeDefaultOptions(defaults, existing);
        if (existing && !hasCanonicalValueChanged(existing, merged)) {
            return { merged, changed: false };
        }

        return { merged, changed: true };
    }

    private async syncPendingDefaults<T>(
        target: ConfigDefaultsSyncTarget,
        scope: ConfigDefaultsScope,
        pending: Map<string, Record<string, unknown>>,
        createCurrent: (_config: FullConfig) => T,
        applyDefault: (_current: T, _name: string, _defaults: Record<string, unknown>) => boolean,
        buildUpdates: (_current: T) => Partial<FullConfig>,
    ): Promise<void> {
        if (pending.size === 0) {
            return;
        }

        const current = createCurrent(target.config);
        let changed = false;

        for (const [name, defaults] of pending) {
            changed = applyDefault(current, name, defaults) || changed;
        }

        if (changed) {
            await this.persistDefaultsUpdate(target, buildUpdates(current), scope);
        }

        pending.clear();
    }

    private async syncPluginDefaults(target: ConfigDefaultsSyncTarget): Promise<void> {
        await this.syncPendingDefaults(
            target,
            'plugin',
            this.pendingDefaults.plugin,
            (config) =>
                config.plugins.map((plugin) => ({
                    ...plugin,
                    options: plugin.options ? { ...plugin.options } : {},
                })),
            (plugins, name, defaults) => {
                const index = plugins.findIndex((plugin) => plugin.name === name);
                const existing = index >= 0 ? plugins[index] : undefined;
                const { merged, changed } = this.mergeRegisteredDefaults(
                    defaults,
                    existing?.options,
                );
                if (!existing) {
                    plugins.push({ name, enabled: true, options: merged });
                    return true;
                }

                if (!changed) {
                    return false;
                }

                plugins[index] = {
                    ...existing,
                    options: merged,
                };
                return true;
            },
            (plugins) => ({ plugins }),
        );
    }

    private async syncChannelDefaults(target: ConfigDefaultsSyncTarget): Promise<void> {
        await this.syncPendingDefaults(
            target,
            'channel',
            this.pendingDefaults.channel,
            (config) => ({ ...config.channels }),
            (channels, name, defaults) => {
                const existing = channels[name];
                const { merged, changed } = this.mergeRegisteredDefaults(defaults, existing);
                if (!changed) {
                    return false;
                }

                channels[name] = merged;
                return true;
            },
            (channels) => ({ channels }),
        );
    }
}

/** 配置管理器
 *
 * 基于 c12 实现热重载配置管理，支持默认值注册与配置变更监听。
 * selfUpdating 守卫防止写入配置文件时触发自身的热重载回调。
 */
export class ConfigManager {
    private store: ConfigStore;
    private initialized = false;
    private configPath: string;
    /** 标记当前是否正在写入配置文件，用于忽略自身触发的文件变更事件 */
    private selfUpdating = false;
    private selfUpdateResetTimer: ReturnType<typeof setTimeout> | null = null;
    private watcher: { unwatch: () => Promise<void> } | null = null;
    private defaultsRegistry = new ConfigDefaultsRegistry();
    private configChangeListeners = new Set<ConfigChangeListener>();

    get config(): FullConfig {
        if (!this.initialized) {
            throw new Error('ConfigManager not initialized');
        }
        return this.store.readonlyView;
    }

    constructor() {
        this.configPath = pathResolver.getConfigFilePath();
        this.store = new ConfigStore(DEFAULT_CONFIG);
    }

    /** 初始化配置管理器：加载配置、设置热重载监听 */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await this.initializeWithC12();
            this.initialized = true;
            logger.info(
                { configPath: this.configPath },
                'ConfigManager initialized with hot-reload',
            );
        } catch (error) {
            logger.error({ error }, 'Failed to initialize ConfigManager');
            throw error;
        }
    }

    /** 构建 c12 加载/监听选项 */
    private buildC12Options() {
        const parsed = path.parse(this.configPath);
        return {
            cwd: path.dirname(this.configPath),
            configFile: parsed.ext ? parsed.name : parsed.base,
            name: 'config',
            defaults: DEFAULT_CONFIG,
        };
    }

    /** 使用 c12 加载配置并设置热重载监听 */
    private async initializeWithC12(): Promise<void> {
        const result = await loadConfig(this.buildC12Options());

        if (result.config) {
            await this.applyResolvedConfig(result, {
                failureMsg: 'Config parse failed, using cached/default config',
                successMsg: 'Config loaded successfully',
                writeBackMsg: 'Updated config file with default values',
                beforeWriteBackMsg: 'Config was incomplete, added missing fields with defaults',
            });
        } else {
            const parsed = this.parseConfig({});
            const defaultConfig = parsed.config ?? {
                ...DEFAULT_CONFIG,
                channels: {},
            };
            this.store.replace(defaultConfig);
            await fs.promises.writeFile(
                this.configPath,
                JSON.stringify(defaultConfig, null, 2),
                'utf-8',
            );
            logger.info({ path: this.configPath }, 'Default config file generated');
        }

        await this.setupWatchWithC12();
        this.resetSelfUpdating();
    }

    /** 解析并验证原始配置
     *
     * 使用 Zod 验证，验证失败时尝试用默认值填充缺失字段。
     */
    private parseConfig(raw: unknown) {
        return parseConfigFromRaw(raw, {
            onValidationFailure: (error) => {
                logger.warn(
                    { issues: this.formatZodErrors(error) },
                    'Zod validation failed, attempting to fill missing fields with defaults',
                );
            },
            onParseError: (error) => {
                logger.error({ error }, 'Config parse error, keeping existing config');
            },
            onPartialMergeFailure: () => {
                logger.warn({}, 'Partial config merge also failed, keeping existing config');
            },
            logNoProviders: () => {
                logger.info({}, 'No providers configured, adding default provider example');
            },
            logNoMcpServers: () => {
                logger.info({}, 'No MCP servers configured, adding default MCP server example');
            },
            logNoChannels: (mergedWithDefaults) => {
                logger.info(
                    {},
                    mergedWithDefaults
                        ? 'No channels configured, adding default channel example'
                        : 'No channels configured, channels will be loaded from plugins',
                );
            },
            logMergedDefaults: () => {
                logger.info({}, 'Successfully merged user config with defaults');
            },
        });
    }

    /** 设置 c12 配置文件变更监听 */
    private async setupWatchWithC12(): Promise<void> {
        if (this.watcher) {
            return;
        }

        try {
            const watchResult = await watchConfig({
                ...this.buildC12Options(),
                debounce: 200,
                onWatch: (event) => {
                    logger.debug({}, `Config file ${event.type}: ${event.path}`);
                },
                acceptHMR: async ({ newConfig }) => {
                    try {
                        const parsed = this.parseConfig(newConfig.config);
                        if (!parsed.config) {
                            logger.warn(
                                {},
                                'HMR rejected: merged config failed Zod validation, keeping previous snapshot',
                            );
                            return true;
                        }
                        return false;
                    } catch {
                        logger.warn(
                            {},
                            'HMR rejected: exception during validation, keeping previous snapshot',
                        );
                        return true;
                    }
                },
                onUpdate: async ({ newConfig }) => {
                    if (this.selfUpdating) {
                        logger.debug({}, 'Ignoring self-triggered config update');
                        return;
                    }
                    logger.info({}, 'Reloading configuration...');
                    try {
                        await this.applyResolvedConfig(newConfig, {
                            failureMsg: 'Config reload failed, keeping old config',
                            successMsg: 'Configuration reloaded successfully',
                            writeBackMsg: 'Updated config file with default values after reload',
                        });
                    } catch (error) {
                        logger.error({ error }, 'Config reload failed, keeping cached config');
                    }
                },
            });

            this.watcher = watchResult;
            logger.info({}, 'c12 watchConfig setup successfully');
        } catch (error) {
            logger.error({ error }, 'Failed to setup c12 watchConfig');
            throw error;
        }
    }

    /** 应用解析后的配置
     *
     * 验证通过后替换内存中的配置，并在配置发生变化时通知监听器。
     */
    private async applyResolvedConfig(
        resolved: ResolvedConfig<Record<string, unknown>>,
        opts: {
            failureMsg: string;
            successMsg: string;
            writeBackMsg: string;
            beforeWriteBackMsg?: string;
        },
    ): Promise<void> {
        const parsed = this.parseConfig(resolved.config);
        if (!parsed.config) {
            logger.warn({}, opts.failureMsg);
            return;
        }

        if (parsed.shouldWriteBack) {
            if (opts.beforeWriteBackMsg) {
                logger.info({}, opts.beforeWriteBackMsg);
            }
            await this.saveToDisk(parsed.config);
            logger.info({ path: this.configPath }, opts.writeBackMsg);
        }

        const prev = this.store.snapshot;
        this.store.replace(parsed.config);
        logger.info({ path: this.configPath }, opts.successMsg);

        if (prev !== this.store.snapshot) {
            await this.notifyConfigChange(parsed.config, prev);
        }
    }

    /** 调度 selfUpdating 标志重置
     *
     * 写入配置文件后设置 selfUpdating = true，延迟重置为 false。
     * 若多次写入，重置计时器会重新计时。
     */
    private scheduleSelfUpdateReset(delayMs = 500): void {
        this.selfUpdating = true;
        if (this.selfUpdateResetTimer) {
            clearTimeout(this.selfUpdateResetTimer);
        }
        this.selfUpdateResetTimer = setTimeout(() => {
            this.selfUpdating = false;
            this.selfUpdateResetTimer = null;
        }, delayMs);
    }

    /** 立即重置 selfUpdating 标志 */
    private resetSelfUpdating(): void {
        if (this.selfUpdateResetTimer) {
            clearTimeout(this.selfUpdateResetTimer);
            this.selfUpdateResetTimer = null;
        }
        this.selfUpdating = false;
    }

    /** 将配置写入磁盘
     *
     * 写入前设置 selfUpdating = true，写入完成后调度重置。
     * 确保文件变更事件不会触发自身的热重载回调。
     */
    private async saveToDisk(config: FullConfig): Promise<void> {
        this.selfUpdating = true;
        try {
            await fs.promises.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
        } finally {
            this.scheduleSelfUpdateReset(250);
        }
    }

    private formatZodErrors(error: ZodError): string {
        return error.issues
            .map((e) => `${e.path?.join('.') || 'unknown'}: ${e.message}`)
            .join('; ');
    }

    /** 注册配置变更监听器，返回取消监听函数 */
    onConfigChange(listener: ConfigChangeListener): () => void {
        this.configChangeListeners.add(listener);
        return () => {
            this.configChangeListeners.delete(listener);
        };
    }

    /** 注册插件/频道的默认值 */
    registerDefaults(
        scope: ConfigDefaultsScope,
        name: string,
        defaults: Record<string, unknown>,
    ): void {
        this.defaultsRegistry.register(scope, name, defaults);
    }

    /** 将所有已注册的默认值同步到配置文件 */
    async syncAllDefaultConfigs(): Promise<void> {
        if (!this.initialized) {
            logger.error({}, 'ConfigManager not initialized');
            return;
        }
        await this.defaultsRegistry.sync(this);
    }

    /** 查询指定插件的运行时配置 */
    getPluginRuntimeConfig(name: string) {
        return this.config.plugins.find((p) => p.name === name);
    }

    /** 监听插件配置变更（仅 plugins 数组部分） */
    onPluginConfigChange(
        listener: (
            _next: readonly PluginRuntimeConfig[],
            _prev: readonly PluginRuntimeConfig[],
        ) => void | Promise<void>,
    ): () => void {
        return this.onConfigChange((next, prev) => listener(next.plugins, prev.plugins));
    }

    /** 更新插件的运行时配置并持久化
     *
     * 自动去重 plugins 数组中的重复项。
     */
    async updatePluginRuntimeConfig(
        name: string,
        changes: { enabled: boolean; options?: Record<string, unknown> },
    ): Promise<boolean> {
        const current = this.config.plugins;
        let matched = false;
        const deduplicated: PluginRuntimeConfig[] = [];
        const seenNames = new Set<string>();

        for (const p of current) {
            if (seenNames.has(p.name)) {
                continue;
            }
            seenNames.add(p.name);

            if (p.name === name) {
                matched = true;
                deduplicated.push({
                    ...p,
                    enabled: changes.enabled,
                    options: changes.options ?? (p.options ? { ...p.options } : {}),
                });
            } else {
                deduplicated.push({ ...p, options: p.options ? { ...p.options } : {} });
            }
        }

        if (!matched) {
            deduplicated.push({
                name,
                enabled: changes.enabled,
                options: changes.options || {},
            });
        }

        return this.updateConfig({ plugins: deduplicated });
    }

    /** 更新配置并持久化
     *
     * 使用自定义 defu 策略合并更新，验证通过后写入磁盘并通知监听器。
     */
    async updateConfig(updates: Partial<FullConfig>): Promise<boolean> {
        if (!this.initialized) {
            logger.error({}, 'ConfigManager not initialized');
            return false;
        }
        try {
            const merged = mergeConfigUpdates(updates, this.store.snapshot) as FullConfig;
            const result = FullConfigSchema.safeParse(merged);
            if (!result.success) {
                logger.warn(
                    { issues: this.formatZodErrors(result.error) },
                    'Update validation failed',
                );
                return false;
            }
            const prev = this.store.snapshot;
            await this.saveToDisk(result.data);
            this.store.replace(result.data);
            await this.notifyConfigChange(result.data, prev);
            return true;
        } catch (error) {
            logger.error({ error }, 'Update config failed');
            return false;
        }
    }

    /** 通知所有配置变更监听器 */
    private async notifyConfigChange(next: FullConfig, prev: FullConfig): Promise<void> {
        for (const listener of this.configChangeListeners) {
            try {
                await listener(next, prev);
            } catch (error) {
                logger.error({ error }, 'Config change listener failed');
            }
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    /** 销毁配置管理器
     *
     * 取消文件监听、重置 selfUpdating、清除监听器。
     */
    async destroy(): Promise<void> {
        if (this.watcher) {
            await this.watcher.unwatch();
            this.watcher = null;
        }
        this.resetSelfUpdating();
        this.configChangeListeners.clear();
        this.initialized = false;
        logger.info({}, 'ConfigManager destroyed');
    }
}

export const configManager = new ConfigManager();
