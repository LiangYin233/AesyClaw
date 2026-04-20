/** @file 配置切片抽取与变更监听工具
 *
 * 提供从 ConfigManager 中安全抽取配置子集的工具函数，
 * 以及对配置子集变更的监听注册。
 *
 * getConfigSlice — 在 ConfigManager 未初始化时返回 fallback，初始化后按 selector 抽取
 * onConfigSliceChange — 监听全局配置变更，仅在指定切片的规范值发生变化时触发回调，
 *                       避免无关变更导致不必要的重载
 */

import { hasCanonicalValueChanged } from '@/platform/utils/canonical-stringify.js';
import type { ConfigManagerService } from '@/contracts/runtime-services.js';

/** 从 ConfigManager 中安全抽取配置切片
 *
 * 若 ConfigManager 未初始化则返回 fallback，避免启动顺序问题。
 * selector 函数从完整配置中选取目标子集（如 config.plugins）。
 */
export function getConfigSlice<T>(
    configManager: ConfigManagerService,
    selector: (_config: ConfigManagerService['config']) => T | undefined,
    fallback: T,
): T {
    if (!configManager.isInitialized()) {
        return fallback;
    }

    return selector(configManager.config) ?? fallback;
}

/** 监听配置切片变更
 *
 * 注册全局配置变更监听器，但仅在指定切片的规范值（canonical stringify）
 * 发生变化时才触发回调。防止无关配置区域的变化引发不必要的重载。
 *
 * 返回取消监听函数，调用方可在此切片不再需要监听时调用。
 */
export function onConfigSliceChange<T>(
    configManager: ConfigManagerService,
    selector: (_config: ConfigManagerService['config']) => T | undefined,
    fallback: T,
    listener: (_next: T, _prev: T) => Promise<void>,
): () => void {
    return configManager.onConfigChange(async (nextConfig, previousConfig) => {
        const nextValue = selector(nextConfig) ?? fallback;
        const previousValue = selector(previousConfig) ?? fallback;
        if (!hasCanonicalValueChanged(previousValue, nextValue)) {
            return;
        }

        await listener(nextValue, previousValue);
    });
}
