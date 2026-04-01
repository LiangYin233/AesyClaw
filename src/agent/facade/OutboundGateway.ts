import type { OutboundMessage } from '../../types.js';

export class OutboundDispatcherNotConfiguredError extends Error {
  constructor() {
    super('Outbound dispatcher not configured');
    this.name = 'OutboundDispatcherNotConfiguredError';
  }
}

export class OutboundGateway {
  private dispatcher?: (message: OutboundMessage) => Promise<void>;
  private pendingDispatcher: Promise<(message: OutboundMessage) => Promise<void>>;
  private resolvePending!: (d: (message: OutboundMessage) => Promise<void>) => void;

  constructor() {
    this.pendingDispatcher = new Promise((resolve) => {
      this.resolvePending = resolve;
    });
  }

  setDispatcher(dispatcher: (message: OutboundMessage) => Promise<void>): void {
    this.dispatcher = dispatcher;
    this.resolvePending(dispatcher);
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.dispatcher) {
      this.dispatcher = await this.pendingDispatcher;
    }
    try {
      await this.dispatcher(message);
    } catch (error) {
      console.error('消息发送失败', { error, messageId: message.id });
    }
  }
}
