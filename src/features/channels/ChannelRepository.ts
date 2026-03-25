import type { ChannelHandle, ChannelManager } from '../../channels/ChannelManager.js';
import type { Config } from '../../types.js';

export class ChannelRepository {
  constructor(
    private readonly channelManager: ChannelManager,
    private readonly getConfig: () => Config
  ) {}

  getRuntimeStatus(): Record<string, { running: boolean }> {
    return this.channelManager.getStatus();
  }

  getConfiguredChannels(): Config['channels'] {
    return this.getConfig().channels;
  }

  getChannel(name: string): ChannelHandle | undefined {
    return this.channelManager.get(name);
  }
}
