import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { logger } from '../logger/index.js';
import type { ChannelManager, ChannelPluginDefinition } from './ChannelManager.js';

const log = logger.child({ prefix: 'ChannelPluginLoader' });

function isChannelPluginDefinition(value: unknown): value is ChannelPluginDefinition {
  return !!value
    && typeof value === 'object'
    && typeof (value as ChannelPluginDefinition).pluginName === 'string'
    && typeof (value as ChannelPluginDefinition).channelName === 'string'
    && typeof (value as ChannelPluginDefinition).create === 'function';
}

async function discoverChannelPluginEntries(workspace: string): Promise<string[]> {
  const pluginsDir = join(workspace, 'plugins');

  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    const discovered: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('channel_')) {
        continue;
      }

      const mainPath = join(pluginsDir, entry.name, 'main.ts');

      try {
        const mainStat = await stat(mainPath);
        if (mainStat.isFile()) {
          discovered.push(mainPath);
        }
      } catch {
        continue;
      }
    }

    return discovered;
  } catch {
    return [];
  }
}

async function importChannelPlugin(mainPath: string): Promise<ChannelPluginDefinition | null> {
  try {
    const module = await import(pathToFileURL(mainPath).href);
    const plugin = module.default ?? module;

    if (!isChannelPluginDefinition(plugin)) {
      return null;
    }

    if (!plugin.pluginName.startsWith('channel_')) {
      return null;
    }

    return plugin;
  } catch (error) {
    log.warn(`Failed to import channel plugin from ${mainPath}:`, error);
    return null;
  }
}

export async function loadExternalChannelPlugins(channelManager: ChannelManager, workspace: string): Promise<void> {
  const entries = await discoverChannelPluginEntries(workspace);

  for (const mainPath of entries) {
    const plugin = await importChannelPlugin(mainPath);
    if (!plugin) {
      log.warn(`Invalid channel plugin skipped: ${mainPath}`);
      continue;
    }

    channelManager.registerPlugin(plugin);
  }
}
