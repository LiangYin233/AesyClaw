import { mkdir, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { logger } from '../observability/index.js';
import type { ChannelManager, ChannelPluginDefinition } from './ChannelManager.js';
import { pathToFileURL } from 'url';
import { normalizeChannelError } from './errors.js';

const log = logger.child('ChannelPluginLoader');

async function importChannelModule<T = unknown>(modulePath: string): Promise<T> {
  const tmpDir = join(process.cwd(), '.tmp', 'tsx');
  await mkdir(tmpDir, { recursive: true });
  process.env.TMPDIR = tmpDir;
  process.env.TEMP = tmpDir;
  process.env.TMP = tmpDir;

  const { tsImport } = await import('tsx/esm/api');
  return tsImport(pathToFileURL(modulePath).href, { parentURL: import.meta.url }) as Promise<T>;
}

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
    const module = await importChannelModule<Record<string, unknown>>(mainPath);
    const plugin = module.default ?? module;

    if (!isChannelPluginDefinition(plugin)) {
      return null;
    }

    if (!plugin.pluginName.startsWith('channel_')) {
      return null;
    }

    return plugin;
  } catch (error) {
    log.warn(`导入渠道插件失败: ${mainPath}`, {
      path: mainPath,
      error: normalizeChannelError(error)
    });
    return null;
  }
}

export async function loadExternalChannelPlugins(channelManager: ChannelManager, workspace: string): Promise<void> {
  const entries = await discoverChannelPluginEntries(workspace);

  for (const mainPath of entries) {
    const plugin = await importChannelPlugin(mainPath);
    if (!plugin) {
      log.warn(`渠道插件无效，已跳过: ${mainPath}`);
      continue;
    }

    channelManager.registerPlugin(plugin);
  }
}
