/** Dynamic channel extension loader. */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createScopedLogger } from '../core/logger';
import type { ChannelLoaderOptions, ChannelModule, ChannelPlugin } from './channel-types';
import { isChannelPlugin, isRecord } from './channel-types';

const logger = createScopedLogger('channel-loader');

export class ChannelLoader {
  private readonly extensionsDir: string;

  constructor(options: ChannelLoaderOptions = {}) {
    this.extensionsDir = options.extensionsDir ?? path.resolve(process.cwd(), 'extensions');
  }

  async discover(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.extensionsDir);
    } catch (err) {
      logger.warn('Channel extensions directory is not readable', {
        extensionsDir: this.extensionsDir,
        error: errorMessage(err),
      });
      return [];
    }

    const channelDirs: string[] = [];
    for (const entry of entries) {
      if (!entry.startsWith('channel_')) {
        continue;
      }

      const fullPath = path.join(this.extensionsDir, entry);
      try {
        const entryStat = await stat(fullPath);
        if (entryStat.isDirectory()) {
          channelDirs.push(fullPath);
        }
      } catch (err) {
        logger.warn('Failed to inspect channel directory candidate', {
          channelDir: fullPath,
          error: errorMessage(err),
        });
      }
    }

    return channelDirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  }

  async load(channelDir: string): Promise<ChannelModule> {
    const entryPath = await this.resolveEntry(channelDir);
    const entryUrl = pathToFileURL(entryPath);
    entryUrl.searchParams.set('mtime', String((await stat(entryPath)).mtimeMs));

    const imported: unknown = await import(entryUrl.href);
    const definition = extractDefinition(imported);

    if (!definition) {
      throw new Error(`Channel module "${entryPath}" does not export a valid ChannelPlugin`);
    }

    logger.debug('Loaded channel module', { channelDir, entryPath, channelName: definition.name });
    return {
      definition,
      directory: channelDir,
      directoryName: path.basename(channelDir),
      entryPath,
    };
  }

  private async resolveEntry(channelDir: string): Promise<string> {
    const candidates = ['index.ts', 'index.js', 'index.mjs'].map((file) =>
      path.join(channelDir, file),
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
      `Channel directory "${channelDir}" has no index.ts, index.js, or index.mjs entry`,
    );
  }
}

function extractDefinition(imported: unknown): ChannelPlugin | null {
  if (!isRecord(imported)) {
    return null;
  }

  const factoryCandidate = imported.createChannel;
  if (typeof factoryCandidate === 'function') {
    const channel = factoryCandidate();
    if (isChannelPlugin(channel)) {
      return channel;
    }
  }

  for (const [exportName, exported] of Object.entries(imported)) {
    if (!/^create[A-Z].*Channel$/.test(exportName) || typeof exported !== 'function') {
      continue;
    }

    const channel = exported();
    if (isChannelPlugin(channel)) {
      return channel;
    }
  }

  const directCandidate = imported.default ?? imported.channel;
  if (isChannelPlugin(directCandidate)) {
    return directCandidate;
  }

  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
