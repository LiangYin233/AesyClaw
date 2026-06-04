/**
 * loader — 插件的磁盘发现和模块加载逻辑。
 *
 * 从 PluginManager 中提取，专注目录扫描、模块导入和按名称查找。
 */

import path from 'node:path';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { ExtensionError, type ExtensionKind } from '@aesyclaw/core/errors';
import { loadExtensionModule, discoverExtensionDirs } from '@aesyclaw/extension/extension-loader';
import { discoverPluginDefinition, type PluginModule } from './types';

const logger = createScopedLogger('plugin-loader');

/** 扫描磁盘插件目录。 */
export async function discoverPluginDirs(extensionsDir: string): Promise<string[]> {
  return await discoverExtensionDirs({
    extensionsDir,
    directoryPrefix: 'plugin_',
    logger,
    unreadableMessage: '插件扩展目录不可读',
    inspectFailureMessage: '检查插件目录候选失败',
    candidateField: 'pluginDir',
  });
}

/** 安全加载插件模块（无缓存，每次都重新导入）。 */
export async function safeLoadModule(
  pluginDir: string,
  failedPlugins: Map<string, ExtensionError>,
): Promise<PluginModule | null> {
  try {
    return await loadExtensionModule(pluginDir, 'Plugin', discoverPluginDefinition);
  } catch (err) {
    const directoryName = path.basename(pluginDir);
    failedPlugins.set(
      directoryName,
      ExtensionError.fromUnknown(err, 'load', 'plugin' satisfies ExtensionKind, directoryName),
    );
    return null;
  }
}
