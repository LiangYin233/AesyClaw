/** Dynamic plugin loader. */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createScopedLogger } from '../core/logger';
import type { PluginLoaderOptions, PluginModule } from './plugin-types';
import { isPluginDefinition, isRecord } from './plugin-types';

const logger = createScopedLogger('plugin-loader');

export class PluginLoader {
  private readonly extensionsDir: string;

  constructor(options: PluginLoaderOptions = {}) {
    this.extensionsDir = options.extensionsDir ?? path.resolve(process.cwd(), 'extensions');
  }

  async discover(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.extensionsDir);
    } catch (err) {
      logger.warn('Plugin extensions directory is not readable', {
        extensionsDir: this.extensionsDir,
        error: errorMessage(err),
      });
      return [];
    }

    const pluginDirs: string[] = [];
    for (const entry of entries) {
      if (!entry.startsWith('plugin_') && !entry.startsWith('channel_')) {
        continue;
      }

      const fullPath = path.join(this.extensionsDir, entry);
      try {
        const entryStat = await stat(fullPath);
        if (entryStat.isDirectory()) {
          pluginDirs.push(fullPath);
        }
      } catch (err) {
        logger.warn('Failed to inspect plugin directory candidate', {
          pluginDir: fullPath,
          error: errorMessage(err),
        });
      }
    }

    return pluginDirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  }

  async load(pluginDir: string): Promise<PluginModule> {
    const entryPath = await this.resolveEntry(pluginDir);
    const entryUrl = pathToFileURL(entryPath);
    entryUrl.searchParams.set('mtime', String((await stat(entryPath)).mtimeMs));

    const imported: unknown = await import(entryUrl.href);
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

  private async resolveEntry(pluginDir: string): Promise<string> {
    const candidates = ['index.ts', 'index.js', 'index.mjs'].map((file) =>
      path.join(pluginDir, file),
    );
    for (const candidate of candidates) {
      try {
        const candidateStat = await stat(candidate);
        if (candidateStat.isFile()) {
          return candidate;
        }
      } catch {
        // Try the next supported entry filename.
      }
    }

    throw new Error(
      `Plugin directory "${pluginDir}" has no index.ts, index.js, or index.mjs entry`,
    );
  }
}

function extractDefinition(imported: unknown) {
  if (!isRecord(imported)) {
    return null;
  }

  const candidate = imported.default ?? imported.plugin;
  return isPluginDefinition(candidate) ? candidate : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
