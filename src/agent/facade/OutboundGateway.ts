import type { OutboundMessage } from '../../types.js';
import { logger } from '../../platform/observability/index.js';

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
      logger.debug(`消息发送成功`, { messageId: message.id, chatId: message.chatId });
    } catch (error) {
      logger.error(`消息发送失败`, { error: error instanceof Error ? error.message : String(error), messageId: message.id });
    }
  }
}
