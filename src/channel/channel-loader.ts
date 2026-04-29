/** Dynamic channel extension loader. */

import path from 'node:path';
import { createScopedLogger } from '../core/logger';
import {
  discoverExtensionDirs,
  importExtensionEntry,
  resolveExtensionEntry,
} from '../extensions/extension-loader';
import type { ChannelLoaderOptions, ChannelModule, ChannelPlugin } from './channel-types';
import { isChannelPlugin, isRecord } from './channel-types';

const logger = createScopedLogger('channel-loader');

export class ChannelLoader {
  private readonly extensionsDir: string;

  constructor(options: ChannelLoaderOptions = {}) {
    this.extensionsDir = options.extensionsDir ?? path.resolve(process.cwd(), 'extensions');
  }

  async discover(): Promise<string[]> {
    return discoverExtensionDirs({
      extensionsDir: this.extensionsDir,
      directoryPrefix: 'channel_',
      logger,
      unreadableMessage: 'Channel extensions directory is not readable',
      inspectFailureMessage: 'Failed to inspect channel directory candidate',
      candidateField: 'channelDir',
    });
  }

  async load(channelDir: string): Promise<ChannelModule> {
    const entryPath = await resolveExtensionEntry(channelDir, 'Channel');
    const imported = await importExtensionEntry(entryPath);
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
