import type { OutboundMessage } from '../types.js';
import { logger } from '../logger/index.js';

export class OutboundGateway {
  private log = logger.child({ prefix: 'OutboundGateway' });
  private dispatcher?: (message: OutboundMessage) => Promise<void>;

  setDispatcher(dispatcher: (message: OutboundMessage) => Promise<void>): void {
    this.dispatcher = dispatcher;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.dispatcher) {
      this.log.error('Outbound dispatcher missing', {
        channel: message.channel,
        chatId: message.chatId
      });
      throw new Error('Outbound dispatcher not configured');
    }

    await this.dispatcher(message);
  }
}
