/**
 * loader — 插件的磁盘发现和模块加载逻辑。
 *
 * 从 PluginManager 中提取，专注目录扫描、模块导入和按名称查找。
 */

import path from 'node:path';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { errorMessage } from '@aesyclaw/core/utils';
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
  failedPlugins: Map<string, string>,
): Promise<PluginModule | null> {
  try {
    return await loadExtensionModule(pluginDir, 'Plugin', discoverPluginDefinition);
  } catch (err) {
    failedPlugins.set(path.basename(pluginDir), errorMessage(err));
    return null;
  }
}

/** 按名称或目录名查找插件（先查已加载，再扫磁盘）。 */
export async function findPlugin(
  nameOrAlias: string,
  loadedPlugins: Map<
    string,
    { definition: PluginModule['definition']; directory: string; directoryName: string }
  >,
  extensionsDir: string,
  failedPlugins: Map<string, string>,
): Promise<PluginModule | null> {
  // 先查已加载的
  for (const loaded of loadedPlugins.values()) {
    if (loaded.definition.name === nameOrAlias || loaded.directoryName === nameOrAlias) {
      return {
        definition: loaded.definition,
        directory: loaded.directory,
        directoryName: loaded.directoryName,
        entryPath: '',
      };
    }
  }

  // 再扫磁盘
  const pluginDirs = await discoverPluginDirs(extensionsDir);
  for (const pluginDir of pluginDirs) {
    const directoryName = path.basename(pluginDir);
    const module = await safeLoadModule(pluginDir, failedPlugins);
    if (!module) continue;
    if (directoryName === nameOrAlias || module.definition.name === nameOrAlias) {
      return module;
    }
  }
  return null;
}
