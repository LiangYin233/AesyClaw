import { logger } from '../../logger/index.js';
import { CONSTANTS } from '../../constants/index.js';
import type { Services } from '../factory/ServiceFactory.js';

const log = logger.child({ prefix: 'Bootstrap' });

export async function startChannels(services: Services): Promise<void> {
  const { channelManager } = services;
  const startedAt = Date.now();
  try {
    await Promise.race([
      channelManager.startAll(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Channel start timeout')), CONSTANTS.CHANNEL_START_TIMEOUT)
      )
    ]);
  } catch (error) {
    log.error('Channel startup failed', { error });
  }
  log.info('Channel startup finished', {
    channelCount: channelManager.getEnabledChannels().length,
    durationMs: Date.now() - startedAt
  });
}
