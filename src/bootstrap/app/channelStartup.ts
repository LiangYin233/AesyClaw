import { logger } from '../../logger/index.js';
import { CONSTANTS } from '../../constants/index.js';
import type { Services } from '../factory/ServiceFactory.js';

const log = logger.child({ prefix: 'Bootstrap' });

export async function startChannels(services: Services): Promise<void> {
  const { channelManager } = services;
  try {
    await Promise.race([
      channelManager.startAll(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Channel start timeout')), CONSTANTS.CHANNEL_START_TIMEOUT)
      )
    ]);
  } catch (error) {
    log.error('Channel start failed:', error);
  }
  log.info('Channels started');
}
