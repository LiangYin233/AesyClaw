/** 动态插件加载器。 */

import { createScopedLogger } from '../../core/logger';
import { ExtensionLoader } from '../extension-loader';
import type { PluginLoaderOptions, PluginDefinition } from './plugin-types';
import { isPluginDefinition } from './plugin-types';
import { isRecord } from '../../core/utils';

const logger = createScopedLogger('plugin-loader');

export class PluginLoader extends ExtensionLoader<PluginDefinition> {
  constructor(options: PluginLoaderOptions = {}) {
    super({
      extensionsDir: options.extensionsDir,
      directoryPrefix: 'plugin_',
      kind: 'Plugin',
      invalidMessage: '未导出有效的 PluginDefinition',
      unreadableMessage: '插件扩展目录不可读',
      inspectFailureMessage: '检查插件目录候选失败',
      candidateField: 'pluginDir',
      logger,
      extract: extractPluginDefinition,
    });
  }
}

function extractPluginDefinition(imported: unknown): PluginDefinition | null {
  if (!isRecord(imported)) {
    return null;
  }

  const candidate = imported['default'] ?? imported['plugin'];
  return isPluginDefinition(candidate) ? candidate : null;
}
