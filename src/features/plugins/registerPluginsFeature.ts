import { PluginApiService } from './PluginApiService.js';
import { PluginRepository } from './PluginRepository.js';
import { registerPluginsController } from './plugins.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerPluginsFeature(deps: ApiFeatureControllerDeps): void {
  registerPluginsController(
    deps.app,
    new PluginApiService(new PluginRepository({
      pluginManager: deps.pluginManager,
      channelManager: deps.channelManager,
      getConfig: deps.getConfig,
      updateConfig: deps.updateConfig
    }))
  );
}
