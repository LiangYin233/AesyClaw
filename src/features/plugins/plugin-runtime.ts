/** @file 插件运行时包装器
 *
 * PluginRuntime 是 PluginManager 的薄包装层，
 * 负责将 PluginManager 的生命周期与 AppRuntime 的编排对齐：
 * - start()：初始化 PluginManager 并加载已启用的插件
 * - watchConfigChanges()：启用配置热重载监听
 * - stop()：关闭 PluginManager（卸载所有插件）
 */

import type { PluginRuntimeConfig } from '@/contracts/commands.js';
import { logger } from '@/platform/observability/logger.js';
import { PluginManager } from './plugin-manager.js';

/** 插件配置源，提供当前已启用的插件配置列表 */
export interface PluginRuntimeConfigSource {
    getPluginConfigs(): readonly PluginRuntimeConfig[];
}

interface PluginRuntimeDependencies {
    pluginManager: PluginManager;
    configSource: PluginRuntimeConfigSource;
}

/** 插件运行时包装器
 *
 * 将 PluginManager 的生命周期操作封装为 AppRuntime 可调用的接口。
 */
export class PluginRuntime {
    constructor(private readonly deps: PluginRuntimeDependencies) {}

    /** 获取当前已加载的插件数量 */
    getPluginCount(): number {
        return this.deps.pluginManager.getPluginCount();
    }

    /** 初始化并加载所有已启用的插件 */
    async start(): Promise<void> {
        await this.deps.pluginManager.initialize();
        await this.deps.pluginManager.scanAndLoad(this.deps.configSource.getPluginConfigs());
        logger.info({ loadedPlugins: this.getPluginCount() }, 'Plugins system loaded');
    }

    /** 启用配置热重载监听 */
    watchConfigChanges(): void {
        this.deps.pluginManager.watchConfigChanges();
    }

    /** 关闭插件系统，卸载所有插件 */
    async stop(): Promise<void> {
        await this.deps.pluginManager.shutdown();
    }
}
