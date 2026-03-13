import { logger, normalizeError } from '../../logger/index.js';
import type { Services } from '../factory/ServiceFactory.js';
import type { OutboundMessage } from '../../types.js';

const log = logger.child({ prefix: 'Bootstrap' });

export function wireOutbound(services: Services): void {
  const { eventBus, channelManager } = services;
  eventBus.on('outbound', async (msg: OutboundMessage) => {
    if (channelManager.get(msg.channel)) {
      try {
        await channelManager.dispatch(msg);
      } catch (error: unknown) {
        log.error('Outbound send failed', {
          channel: msg.channel,
          chatId: msg.chatId,
          messageType: msg.messageType,
          error: normalizeError(error)
        });
      }
    } else {
      log.warn('Outbound channel missing', {
        channel: msg.channel,
        chatId: msg.chatId
      });
    }
  });
}
