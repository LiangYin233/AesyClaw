import type { AgentRuntime } from '../../agent/index.js';
import { ChannelManager } from '../../channels/ChannelManager.js';
import { loadExternalChannelPlugins } from '../../channels/ChannelPluginLoader.js';
import { mergeChannelConfigWithDefaults } from '../../channels/config.js';
import { ConfigManager, RuntimeConfigStore } from '../../config/index.js';
import { logger } from '../../observability/index.js';
import { SessionManager } from '../../session/index.js';
import type { Config } from '../../types.js';

const appLog = logger.child('AesyClaw');

async function applyDefaultChannelConfigs(
  channelManager: ChannelManager,
  configStore: RuntimeConfigStore,
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

  const nextConfig = await configManager.update((draft) => {
    for (const { plugin, nextConfig: mergedChannelConfig } of channelEntriesToUpdate) {
      draft.channels[plugin.channelName] = mergedChannelConfig as typeof draft.channels[string];
    }
  });

  configStore.setConfig(nextConfig);
  appLog.info('已应用默认渠道配置', {
    channels: channelEntriesToUpdate.map(({ plugin }) => plugin.channelName)
  });
  return nextConfig;
}

export async function createChannelServices(args: {
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  sessionManager: SessionManager;
  workspace: string;
  agentRuntime: AgentRuntime;
}): Promise<ChannelManager> {
  const { configStore, configManager, sessionManager, workspace, agentRuntime } = args;
  const channelManager = new ChannelManager(sessionManager.getDatabase(), workspace);
  channelManager.setInboundHandler(async (message) => {
    await agentRuntime.handleInbound(message);
  });
  await loadExternalChannelPlugins(channelManager, process.cwd());

  const config = await applyDefaultChannelConfigs(channelManager, configStore, configManager);

  for (const [channelName, channelConfig] of Object.entries(config.channels as Record<string, { enabled?: boolean }>)) {
    if (!channelConfig?.enabled) {
      continue;
    }

    const enabled = await channelManager.enableChannel(channelName, channelConfig);
    if (!enabled) {
      appLog.warn(`未找到渠道插件: ${channelName}`);
    }
  }

  return channelManager;
}
