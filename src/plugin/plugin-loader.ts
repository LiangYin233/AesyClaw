/** Dynamic plugin loader. */

import path from 'node:path';
import { createScopedLogger } from '../core/logger';
import {
  discoverExtensionDirs,
  importExtensionEntry,
  resolveExtensionEntry,
} from '../extensions/extension-loader';
import type { PluginLoaderOptions, PluginModule } from './plugin-types';
import { isPluginDefinition, isRecord } from './plugin-types';

const logger = createScopedLogger('plugin-loader');

export class PluginLoader {
  private readonly extensionsDir: string;

  constructor(options: PluginLoaderOptions = {}) {
    this.extensionsDir = options.extensionsDir ?? path.resolve(process.cwd(), 'extensions');
  }

  async discover(): Promise<string[]> {
    return discoverExtensionDirs({
      extensionsDir: this.extensionsDir,
      directoryPrefix: 'plugin_',
      logger,
      unreadableMessage: 'Plugin extensions directory is not readable',
      inspectFailureMessage: 'Failed to inspect plugin directory candidate',
      candidateField: 'pluginDir',
    });
  }

  async load(pluginDir: string): Promise<PluginModule> {
    const entryPath = await resolveExtensionEntry(pluginDir, 'Plugin');
    const imported = await importExtensionEntry(entryPath);
    const definition = extractDefinition(imported);

    if (!definition) {
      throw new Error(`Plugin module "${entryPath}" does not export a valid PluginDefinition`);
    }

    logger.debug('Loaded plugin module', { pluginDir, entryPath, pluginName: definition.name });
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
