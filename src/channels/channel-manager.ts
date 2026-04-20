/** @file 频道插件管理器
 *
 * ChannelPluginManager 负责频道插件的注册与反注册，
 * 管理频道插件的生命周期（init/destroy）与配置合并。
 *
 * 注册流程：
 * 1. 合并 defaultOptions 与用户配置
 * 2. 注册默认值到 ConfigManager
 * 3. 检查 enabled 字段，禁用则跳过
 * 4. 调用 init() 传入上下文（含 pipeline）
 * 5. 注册成功后将插件加入 channels 映射
 *
 * 反注册流程：
 * 1. 调用 destroy() 释放资源
 * 2. 从 channels 映射中移除
 */

import type { ChannelPlugin, ChannelPluginContext } from './channel-plugin.js';
import type { ChannelPipeline } from '@/agent/pipeline.js';
import type { ConfigDefaultsScope } from '@/contracts/commands.js';
import { logger, createScopedLogger } from '@/platform/observability/logger.js';
import { mergeDefaultOptions } from '@/platform/utils/merge-default-options.js';

/** 频道配置默认值存储接口 */
export interface ChannelConfigDefaultsStore {
    registerDefaults(
        scope: ConfigDefaultsScope,
        name: string,
        defaults: Record<string, unknown>,
    ): void;
}

/** 频道插件管理器 */
export class ChannelPluginManager {
    private channels: Map<string, ChannelPlugin> = new Map();
    private pipeline: ChannelPipeline | null = null;
    private configStore: ChannelConfigDefaultsStore;

    constructor(configStore: ChannelConfigDefaultsStore) {
        this.configStore = configStore;
    }

    /** 设置消息处理流水线引用 */
    setPipeline(pipeline: ChannelPipeline): void {
        this.pipeline = pipeline;
    }

    private getPipeline(): ChannelPipeline {
        if (!this.pipeline) {
            throw new Error('Cannot register channel: pipeline not initialized');
        }

        return this.pipeline;
    }

    /** 合并频道插件的默认配置与用户配置 */
    private mergeChannelOptions(
        plugin: ChannelPlugin,
        userConfig?: Record<string, unknown>,
    ): Record<string, unknown> {
        return mergeDefaultOptions(plugin.defaultOptions || {}, userConfig);
    }

    /** 收集频道插件的默认值并注册到 ConfigManager */
    private collectChannelDefaults(plugin: ChannelPlugin): void {
        if (plugin.defaultOptions && Object.keys(plugin.defaultOptions).length > 0) {
            this.configStore.registerDefaults('channel', plugin.name, plugin.defaultOptions);
        }
    }

    /** 判断频道是否已启用（enabled !== false） */
    private isChannelEnabled(config: Record<string, unknown>): boolean {
        return config.enabled !== false;
    }

    /** 创建频道插件初始化上下文 */
    private createChannelContext(
        name: string,
        config: Record<string, unknown>,
    ): ChannelPluginContext {
        return {
            config,
            logger: createScopedLogger(name, 'channel'),
            pipeline: this.getPipeline(),
        };
    }

    /** 注册频道插件
     *
     * 合并配置、注册默认值、检查启用状态、调用 init()。
     * 初始化失败时调用 destroy() 清理并抛出错误。
     */
    async registerChannel(
        plugin: ChannelPlugin,
        config?: Record<string, unknown>,
    ): Promise<boolean> {
        this.getPipeline();

        if (this.channels.has(plugin.name)) {
            logger.warn(
                { channelName: plugin.name },
                'Channel plugin already registered, skipping',
            );
            return false;
        }

        logger.info(
            { channelName: plugin.name, version: plugin.version },
            'Registering channel plugin',
        );

        const mergedConfig = this.mergeChannelOptions(plugin, config);
        this.collectChannelDefaults(plugin);

        if (!this.isChannelEnabled(mergedConfig)) {
            logger.info(
                { channelName: plugin.name },
                'Channel plugin disabled, skipping registration',
            );
            return false;
        }

        const ctx = this.createChannelContext(plugin.name, mergedConfig);

        try {
            await plugin.init(ctx);

            this.channels.set(plugin.name, plugin);

            logger.info({ channelName: plugin.name }, 'Channel plugin registered successfully');
            return true;
        } catch (error) {
            let cleanupError: unknown;

            try {
                await plugin.destroy();
            } catch (destroyError) {
                logger.error(
                    { channelName: plugin.name, error: destroyError },
                    'Channel plugin cleanup after registration failure failed',
                );
                cleanupError = destroyError;
            }

            logger.error({ channelName: plugin.name, error }, 'Failed to register channel plugin');

            if (cleanupError) {
                throw new AggregateError(
                    [cleanupError],
                    `Channel plugin "${plugin.name}" registration cleanup failed`,
                    { cause: error },
                );
            }

            throw error;
        }
    }

    /** 反注册频道插件
     *
     * 调用 destroy() 释放资源后从 channels 映射中移除。
     */
    async unregisterChannel(name: string): Promise<void> {
        const plugin = this.channels.get(name);
        if (!plugin) {
            logger.warn({ channelName: name }, 'Channel plugin not found, skipping unregister');
            return;
        }

        logger.info({ channelName: name }, 'Unregistering channel plugin');

        try {
            await plugin.destroy();
        } catch (error) {
            logger.error({ channelName: name, error }, 'Error during channel plugin unregister');
            throw error;
        }

        this.channels.delete(name);
        logger.info({ channelName: name }, 'Channel plugin unregistered successfully');
    }

    /** 获取当前已注册的频道数量 */
    getChannelCount(): number {
        return this.channels.size;
    }

    /** 关闭所有频道插件 */
    async shutdown(): Promise<void> {
        logger.info({}, 'Shutting down all channel plugins');

        const shutdownErrors: unknown[] = [];

        for (const name of Array.from(this.channels.keys())) {
            try {
                await this.unregisterChannel(name);
            } catch (error) {
                shutdownErrors.push(error);
            }
        }

        if (shutdownErrors.length === 1) {
            throw shutdownErrors[0];
        }

        if (shutdownErrors.length > 1) {
            throw new AggregateError(
                shutdownErrors,
                'One or more channel plugins failed to shut down cleanly',
            );
        }

        logger.info({}, 'All channel plugins shut down');
    }
}
