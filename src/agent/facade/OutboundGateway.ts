import type { OutboundMessage } from '../../types.js';

export class OutboundDispatcherNotConfiguredError extends Error {
  constructor() {
    super('Outbound dispatcher not configured');
    this.name = 'OutboundDispatcherNotConfiguredError';
  }
}

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
