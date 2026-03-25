import type { Express } from 'express';
import type { ChannelManager } from '../application/ChannelManager.js';
import type { Config } from '../../../types.js';
import { registerChannelsController } from '../api/channels.controller.js';
import { ChannelsService } from '../application/ChannelsService.js';
import { ChannelRepository } from '../infrastructure/ChannelRepository.js';

export interface ChannelsFeatureDeps {
  app: Express;
  channelManager: ChannelManager;
  getConfig: () => Config;
  maxMessageLength: number;
  log: {
    info(message: string, ...args: any[]): void;
  };
}

export function registerChannelsFeature(deps: ChannelsFeatureDeps): void {
  const channelRepository = new ChannelRepository(deps.channelManager, deps.getConfig);

  registerChannelsController(
    deps.app,
    new ChannelsService(channelRepository, deps.maxMessageLength),
    deps.log
  );
}
