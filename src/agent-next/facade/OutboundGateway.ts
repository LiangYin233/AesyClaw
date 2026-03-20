import type { OutboundMessage } from '../../types.js';
import { OutboundDispatcherNotConfiguredError } from '../domain/errors.js';

export class OutboundGateway {
  private dispatcher?: (message: OutboundMessage) => Promise<void>;

  setDispatcher(dispatcher: (message: OutboundMessage) => Promise<void>): void {
    this.dispatcher = dispatcher;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.dispatcher) {
      throw new OutboundDispatcherNotConfiguredError();
    }

    await this.dispatcher(message);
  }
}
