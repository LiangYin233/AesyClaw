import type { Express } from 'express';
import type { ChannelManager } from '../../channels/application/ChannelManager.js';
import type { PluginManager } from '../application/PluginManager.js';
import type { Config } from '../../../types.js';
import { PluginsService } from '../application/PluginsService.js';
import { PluginRepository } from '../infrastructure/PluginRepository.js';
import { registerPluginsController } from '../api/plugins.controller.js';

export interface PluginsFeatureDeps {
  app: Express;
  pluginManager?: PluginManager;
  channelManager: ChannelManager;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
}

export function registerPluginsFeature(deps: PluginsFeatureDeps): void {
  registerPluginsController(
    deps.app,
    new PluginsService(new PluginRepository({
      pluginManager: deps.pluginManager,
      channelManager: deps.channelManager,
      getConfig: deps.getConfig,
      updateConfig: deps.updateConfig
    }))
  );
}
