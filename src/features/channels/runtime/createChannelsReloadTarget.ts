import type { ConfigReloadTargets } from '../../../features/config/reload/ports/ReloadTargets.js';
import type { Services } from '../../../app/bootstrap/factory/ServiceFactory.js';

export function createChannelsReloadTarget(services: Services): NonNullable<ConfigReloadTargets['channels']> {
  return {
    async applyDiff(previousConfig, currentConfig) {
      const channelNames = new Set([
        ...Object.keys(previousConfig.channels),
        ...Object.keys(currentConfig.channels)
      ]);

      for (const channelName of channelNames) {
        const previousChannelConfig = previousConfig.channels[channelName] as Record<string, unknown> | undefined;
        const nextChannelConfig = currentConfig.channels[channelName] as Record<string, unknown> | undefined;

        if (JSON.stringify(previousChannelConfig) === JSON.stringify(nextChannelConfig)) {
          continue;
        }

        if (!services.channelManager.getPlugin(`channel_${channelName}`)) {
          continue;
        }

        const wasEnabled = Boolean(previousChannelConfig?.enabled);
        const isEnabled = Boolean(nextChannelConfig?.enabled);

        if (!wasEnabled && !isEnabled) {
          continue;
        }

        let success = true;
        if (wasEnabled && !isEnabled) {
          success = await services.channelManager.disableChannel(channelName);
        } else if (!wasEnabled && isEnabled) {
          success = await services.channelManager.enableChannel(channelName, nextChannelConfig ?? { enabled: true });
        } else {
          success = await services.channelManager.reconfigureChannel(channelName, nextChannelConfig ?? { enabled: true });
        }

        if (!success) {
          throw new Error(`Failed to reload channel ${channelName}`);
        }
      }
    }
  };
}
