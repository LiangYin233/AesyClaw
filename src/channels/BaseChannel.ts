import type { InboundMessage, OutboundMessage } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';

export abstract class BaseChannel {
  abstract readonly name: string;
  protected config: any;
  protected eventBus: EventBus;
  protected running = false;

  constructor(config: any, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;

  isAllowed(senderId: string): boolean {
    const allowFrom = this.config.allowFrom;
    if (!allowFrom || allowFrom.length === 0) return true;
    return allowFrom.includes(senderId);
  }

  protected async handleMessage(
    senderId: string,
    chatId: string,
    content: string,
    rawEvent?: any,
    messageId?: string,
    messageType?: 'private' | 'group' | 'discuss'
  ): Promise<void> {
    const msg: InboundMessage = {
      channel: this.name,
      senderId,
      chatId,
      content,
      rawEvent,
      timestamp: new Date(),
      messageId,
      messageType
    };

    await this.eventBus.publishInbound(msg);
  }
}
