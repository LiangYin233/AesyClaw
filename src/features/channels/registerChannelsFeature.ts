import { ChannelApiService } from './ChannelApiService.js';
import { ChannelRepository } from './ChannelRepository.js';
import { registerChannelsController } from './channels.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerChannelsFeature(deps: ApiFeatureControllerDeps): void {
  const channelRepository = new ChannelRepository(deps.channelManager, deps.getConfig);

  registerChannelsController(
    deps.app,
    new ChannelApiService(channelRepository, deps.maxMessageLength),
    deps.log
  );
}
