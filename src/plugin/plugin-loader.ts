/** 动态插件加载器。 */

import path from 'node:path';
import { createScopedLogger } from '../core/logger';
import {
  discoverExtensionDirs,
  importExtensionEntry,
  resolveExtensionEntry,
} from '../extensions/extension-loader';
import type { PluginLoaderOptions, PluginModule } from './plugin-types';
import { isPluginDefinition } from './plugin-types';
import { isRecord } from '../core/utils';

const logger = createScopedLogger('plugin-loader');

export class PluginLoader {
  private readonly extensionsDir: string;

  constructor(options: PluginLoaderOptions = {}) {
    this.extensionsDir = options.extensionsDir ?? path.resolve(process.cwd(), 'extensions');
  }

  async discover(): Promise<string[]> {
    return await discoverExtensionDirs({
      extensionsDir: this.extensionsDir,
      directoryPrefix: 'plugin_',
      logger,
      unreadableMessage: '插件扩展目录不可读',
      inspectFailureMessage: '检查插件目录候选失败',
      candidateField: 'pluginDir',
    });
  }

  async load(pluginDir: string): Promise<PluginModule> {
    const entryPath = await resolveExtensionEntry(pluginDir, 'Plugin');
    const imported = await importExtensionEntry(entryPath);
    const definition = extractDefinition(imported);

    if (!definition) {
      throw new Error(`插件模块 "${entryPath}" 未导出有效的 PluginDefinition`);
    }

    logger.debug('已加载插件模块', { pluginDir, entryPath, pluginName: definition.name });
    return {
      definition,
      directory: pluginDir,
      directoryName: path.basename(pluginDir),
      entryPath,
    };
  }
}

function extractDefinition(imported: unknown) {
  if (!isRecord(imported)) {
    return null;
  }

  const candidate = imported.default ?? imported.plugin;
  return isPluginDefinition(candidate) ? candidate : null;
}
