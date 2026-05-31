/**
 * extension-utils — 扩展管理的共享工具函数。
 *
 * 提取 PluginManager 和 ChannelManager 的共享逻辑。
 */

import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import { isRecord, mergeDefaults } from '@aesyclaw/core/utils';

/**
 * 合并扩展的默认配置和用户配置。
 */
export function getMergedExtensionConfig(
  defaults: Record<string, unknown>,
  userConfig: Record<string, unknown>,
): Record<string, unknown> {
  return mergeDefaults(userConfig, defaults);
}

/**
 * 从用户配置中获取指定扩展的配置。
 */
export function getUserExtensionConfig(
  configManager: ConfigManager,
  configKey: string,
  name: string,
): Record<string, unknown> {
  const allConfigs = configManager.get(configKey);
  if (!isRecord(allConfigs)) return {};
  const userConfig = allConfigs[name];
  return isRecord(userConfig) ? userConfig : {};
}

/**
 * 获取扩展的托管默认值（enabled 字段）。
 */
export function getManagedDefaults(
  definition: { defaults?: Record<string, unknown> },
): Record<string, unknown> {
  const { enabled: _enabled, ...rest } = definition.defaults ?? {};
  return { enabled: true, ...rest };
}

/**
 * 从配置中移除 enabled 字段。
 */
export function stripEnabledField(config: Record<string, unknown>): Record<string, unknown> {
  const { enabled: _enabled, ...rest } = config;
  return rest;
}

/**
 * 检查目录是否启用。
 */
export function isDirectoryEnabled(configManager: ConfigManager, directoryName: string): boolean {
  const enabledDirs = configManager.get('extensions.enabledDirectories');
  if (!Array.isArray(enabledDirs)) return false;
  return enabledDirs.includes(directoryName);
}
