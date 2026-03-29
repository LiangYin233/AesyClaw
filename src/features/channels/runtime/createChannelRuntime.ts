import { ChannelManager } from '../application/ChannelManager.js';
import { loadExternalChannelPlugins } from '../application/ChannelPluginLoader.js';
import { mergeChannelConfigWithDefaults } from '../domain/config.js';
import { ChannelRuntime } from './ChannelRuntime.js';
import type { ConfigAccessor } from '../../../platform/context/index.js';
import type { Database } from '../../../platform/db/index.js';
import type { Config } from '../../../types.js';

interface ConfigUpdater {
  update(mutator: (config: Config) => void | Config | Promise<void | Config>): Promise<Config>;
}

interface ConfigManager extends ConfigAccessor {
  update: ConfigUpdater['update'];
}

interface InboundHandler {
  handleInbound(message: unknown, options?: { suppressOutbound?: boolean }): Promise<unknown>;
}

async function applyDefaultChannelConfigs(
  channelManager: ChannelManager,
  configStore: ConfigAccessor,
  configManager: ConfigManager
): Promise<Config> {
  const config = configStore.getConfig();
  const channelEntriesToUpdate = channelManager
    .listPlugins()
    .map((pluginName) => channelManager.getPlugin(pluginName))
    .filter((plugin): plugin is NonNullable<typeof plugin> => Boolean(plugin))
    .map((plugin) => {
      const currentConfig = config.channels[plugin.channelName] as Record<string, unknown> | undefined;
      const nextConfig = mergeChannelConfigWithDefaults(
        channelManager.getPluginDefaultConfig(plugin.pluginName),
        currentConfig
      );

      return {
        plugin,
        currentConfig,
        nextConfig
      };
    })
    .filter(({ currentConfig, nextConfig }) => JSON.stringify(currentConfig ?? {}) !== JSON.stringify(nextConfig));

  if (channelEntriesToUpdate.length === 0) {
    return config;
  }

  const nextConfig = await configManager.update((draft: Config) => {
    for (const { plugin, nextConfig: mergedChannelConfig } of channelEntriesToUpdate) {
      draft.channels[plugin.channelName] = mergedChannelConfig as typeof draft.channels[string];
    }
  });
  return nextConfig;
}

export async function createChannelRuntime(args: {
  configStore: ConfigAccessor;
  configManager: ConfigManager;
  db: Database;
  workspace: string;
  agentRuntime: InboundHandler;
}): Promise<ChannelManager> {
  const { configStore, configManager, db, workspace, agentRuntime } = args;
  const runtime = new ChannelRuntime(db, workspace);
  const channelManager = new ChannelManager(runtime);
  channelManager.setInboundHandler(async (message) => {
    await agentRuntime.handleInbound(message);
  });
  await loadExternalChannelPlugins(channelManager, process.cwd());

  const config = await applyDefaultChannelConfigs(channelManager, configStore, configManager);

  for (const [channelName, channelConfig] of Object.entries(config.channels as Record<string, { enabled?: boolean }>)) {
    if (!channelConfig?.enabled) {
      continue;
    }

    const enabled = channelManager.registerConfiguredChannel(channelName, channelConfig);
    if (!enabled) {
    }
  }

  return channelManager;
}
