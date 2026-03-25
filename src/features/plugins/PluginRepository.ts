import { mergeChannelConfigWithDefaults, stripChannelEnabled } from '../../channels/config.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { PluginManager } from '../../plugins/index.js';
import type { PluginInfo } from '../../plugins/types.js';
import type { Config } from '../../types.js';

interface PluginRepositoryDeps {
  pluginManager?: PluginManager;
  channelManager: ChannelManager;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
}

export class PluginRepository {
  constructor(private readonly deps: PluginRepositoryDeps) {}

  async listAll(): Promise<PluginInfo[]> {
    const plugins = this.deps.pluginManager ? await this.deps.pluginManager.getAllPlugins() : [];
    return [...plugins, ...this.buildChannelPlugins()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async setEnabled(name: string, enabled: boolean): Promise<boolean> {
    const knownPluginNames = await this.getKnownPluginNames();
    if (this.deps.pluginManager && knownPluginNames.has(name)) {
      await this.deps.updateConfig((config) => {
        config.plugins[name] = {
          ...(config.plugins[name] || {}),
          enabled
        };
      });
      return true;
    }

    const channelPlugin = this.deps.channelManager.getPlugin(name);
    if (!channelPlugin) {
      return false;
    }

    await this.deps.updateConfig((config) => {
      const currentChannelConfig = config.channels[channelPlugin.channelName] as Record<string, unknown> | undefined;
      config.channels[channelPlugin.channelName] = mergeChannelConfigWithDefaults(
        this.deps.channelManager.getPluginDefaultConfig(channelPlugin.pluginName),
        {
          ...(currentChannelConfig ?? {}),
          enabled
        }
      ) as typeof config.channels[string];
    });

    return true;
  }

  async updateOptions(name: string, options: Record<string, unknown>): Promise<boolean> {
    const knownPluginNames = await this.getKnownPluginNames();
    if (this.deps.pluginManager && knownPluginNames.has(name)) {
      const config = this.deps.getConfig();
      const currentEnabled = config.plugins[name]?.enabled ?? true;
      await this.deps.updateConfig((draft) => {
        draft.plugins[name] = {
          ...(draft.plugins[name] || {}),
          enabled: currentEnabled,
          options
        };
      });
      return true;
    }

    const channelPlugin = this.deps.channelManager.getPlugin(name);
    if (!channelPlugin) {
      return false;
    }

    await this.deps.updateConfig((config) => {
      const currentChannelConfig = config.channels[channelPlugin.channelName] as Record<string, unknown> | undefined;
      const currentEnabled = Boolean(currentChannelConfig?.enabled);
      config.channels[channelPlugin.channelName] = mergeChannelConfigWithDefaults(
        this.deps.channelManager.getPluginDefaultConfig(channelPlugin.pluginName),
        {
          ...options,
          enabled: currentEnabled
        }
      ) as typeof config.channels[string];
    });

    return true;
  }

  private async getKnownPluginNames(): Promise<Set<string>> {
    if (!this.deps.pluginManager) {
      return new Set<string>();
    }
    return new Set((await this.deps.pluginManager.getAllPlugins()).map((plugin) => plugin.name));
  }

  private buildChannelPlugins(): PluginInfo[] {
    const runtimeStatus = this.deps.channelManager.getStatus();
    const plugins: PluginInfo[] = [];

    for (const pluginName of this.deps.channelManager.listPlugins().sort((left, right) => left.localeCompare(right))) {
      const plugin = this.deps.channelManager.getPlugin(pluginName);
      if (!plugin) {
        continue;
      }

      const defaultOptions = this.deps.channelManager.getPluginDefaultConfig(plugin.pluginName);
      const rawConfig = this.deps.getConfig().channels[plugin.channelName] as Record<string, unknown> | undefined;
      const mergedConfig = mergeChannelConfigWithDefaults(defaultOptions, rawConfig);
      const options = stripChannelEnabled(mergedConfig);

      plugins.push({
        name: plugin.pluginName,
        version: 'channel',
        description: `渠道插件（${plugin.channelName}）`,
        author: 'AesyClaw',
        enabled: Boolean(mergedConfig.enabled),
        options,
        defaultConfig: {
          enabled: false,
          options: defaultOptions
        },
        toolsCount: 0,
        kind: 'channel',
        channelName: plugin.channelName,
        running: runtimeStatus[plugin.channelName]?.running ?? false
      });
    }

    return plugins;
  }
}
