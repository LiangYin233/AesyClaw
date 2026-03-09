import { logger, normalizeError } from '../../logger/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import type { OutboundMessage } from '../../types.js';

const log = logger.child({ prefix: 'Bootstrap' });

export function wireOutbound(services: Services): void {
  const { eventBus, channelManager } = services;
  log.info(`[OUTBOUND_WIRE] Registering outbound event listener, current listener count: ${eventBus.listenerCount('outbound')}`);
  eventBus.on('outbound', async (msg: OutboundMessage) => {
    log.info(`[OUTBOUND_WIRE] Received outbound event for channel=${msg.channel}, chatId=${msg.chatId}, content length=${msg.content.length}`);
    const channel = channelManager.get(msg.channel);
    if (channel) {
      try {
        await channel.send(msg);
      } catch (error: unknown) {
        log.error(`Failed to send: ${normalizeError(error)}`);
      }
    } else {
      log.warn(`Channel ${msg.channel} not found`);
    }
  });
  log.info(`[OUTBOUND_WIRE] Outbound event listener registered, new listener count: ${eventBus.listenerCount('outbound')}`);
}
