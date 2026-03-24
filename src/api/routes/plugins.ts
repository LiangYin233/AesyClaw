import type { Express } from 'express';
import { mergeChannelConfigWithDefaults, stripChannelEnabled } from '../../channels/config.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { PluginManager } from '../../plugins/index.js';
import type { PluginInfo } from '../../plugins/types.js';
import type { Config } from '../../types.js';
import { badRequest, notFound, serverError } from './helpers.js';

interface PluginRouteDeps {
  pluginManager?: PluginManager;
  channelManager: ChannelManager;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
}

export function registerPluginRoutes(app: Express, deps: PluginRouteDeps): void {
  const { pluginManager, channelManager, getConfig, updateConfig } = deps;

  const getMergedChannelConfig = (pluginName: string, channelName: string) => {
    const rawConfig = getConfig().channels[channelName] as Record<string, unknown> | undefined;
    return mergeChannelConfigWithDefaults(
      channelManager.getPluginDefaultConfig(pluginName),
      rawConfig
    );
  };

  const buildChannelPlugins = (): PluginInfo[] => {
    const runtimeStatus = channelManager.getStatus();
    const plugins: PluginInfo[] = [];

    for (const pluginName of channelManager.listPlugins().sort((left, right) => left.localeCompare(right))) {
      const plugin = channelManager.getPlugin(pluginName);
      if (!plugin) {
        continue;
      }

      const defaultOptions = channelManager.getPluginDefaultConfig(plugin.pluginName);
      const mergedConfig = getMergedChannelConfig(plugin.pluginName, plugin.channelName);
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
  };

  app.get('/api/plugins', async (req, res) => {
    try {
      const plugins = pluginManager ? await pluginManager.getAllPlugins() : [];
      const channelPlugins = buildChannelPlugins();
      res.json({
        plugins: [...plugins, ...channelPlugins].sort((left, right) => left.name.localeCompare(right.name))
      });
    } catch (error: unknown) {
      serverError(res, error);
    }
  });

  app.post('/api/plugins/:name/toggle', async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return badRequest(res, 'enabled is required and must be a boolean', 'enabled');
      }
      const { name } = req.params;
      const knownPluginNames = pluginManager
        ? new Set((await pluginManager.getAllPlugins()).map((plugin) => plugin.name))
        : new Set<string>();

      if (pluginManager) {
        if (knownPluginNames.has(name)) {
          await updateConfig((config) => {
            config.plugins[name] = {
              ...(config.plugins[name] || {}),
              enabled
            };
          });
          return res.json({ success: true });
        }
      }

      const channelPlugin = channelManager.getPlugin(name);
      if (!channelPlugin) {
        return notFound(res, 'Plugin', name);
      }

      await updateConfig((config) => {
        const currentChannelConfig = config.channels[channelPlugin.channelName] as Record<string, unknown> | undefined;
        config.channels[channelPlugin.channelName] = mergeChannelConfigWithDefaults(
          channelManager.getPluginDefaultConfig(channelPlugin.pluginName),
          {
            ...(currentChannelConfig ?? {}),
            enabled
          }
        ) as typeof config.channels[string];
      });
      res.json({ success: true });
    } catch (error: unknown) {
      serverError(res, error);
    }
  });

  app.put('/api/plugins/:name/config', async (req, res) => {
    try {
      const { options } = req.body;
      if (!options || typeof options !== 'object') {
        return badRequest(res, 'options is required and must be an object', 'options');
      }
      const { name } = req.params;
      const knownPluginNames = pluginManager
        ? new Set((await pluginManager.getAllPlugins()).map((plugin) => plugin.name))
        : new Set<string>();

      if (pluginManager) {
        if (knownPluginNames.has(name)) {
          const config = getConfig();
          const currentEnabled = config.plugins[name]?.enabled ?? true;
          await updateConfig((config) => {
            config.plugins[name] = {
              ...(config.plugins[name] || {}),
              enabled: currentEnabled,
              options
            };
          });
          return res.json({ success: true });
        }
      }

      const channelPlugin = channelManager.getPlugin(name);
      if (!channelPlugin) {
        return notFound(res, 'Plugin', name);
      }

      await updateConfig((config) => {
        const currentChannelConfig = config.channels[channelPlugin.channelName] as Record<string, unknown> | undefined;
        const currentEnabled = Boolean(currentChannelConfig?.enabled);
        config.channels[channelPlugin.channelName] = mergeChannelConfigWithDefaults(
          channelManager.getPluginDefaultConfig(channelPlugin.pluginName),
          {
            ...options,
            enabled: currentEnabled
          }
        ) as typeof config.channels[string];
      });
      res.json({ success: true });
    } catch (error: unknown) {
      serverError(res, error);
    }
  });
}
