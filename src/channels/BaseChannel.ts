import type { InboundMessage, OutboundMessage } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';

export abstract class BaseChannel {
  abstract readonly name: string;
  protected config: any;
  protected eventBus: EventBus;
  protected running = false;
  protected log = logger;

  constructor(config: any, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;

  isRunning(): boolean {
    return this.running;
  }

  isAllowed(senderId: string, messageType?: 'private' | 'group'): boolean {
    if (messageType === 'group') {
      const groupAllowFrom = this.config.groupAllowFrom;
      if (!groupAllowFrom || groupAllowFrom.length === 0) return true;
      return groupAllowFrom.includes(senderId);
    } else {
      const friendAllowFrom = this.config.friendAllowFrom;
      if (!friendAllowFrom || friendAllowFrom.length === 0) return true;
      return friendAllowFrom.includes(senderId);
    }
  }

  protected async handleMessage(
    senderId: string,
    chatId: string,
    content: string,
    rawEvent?: any,
    messageId?: string,
    messageType?: 'private' | 'group',
    media?: string[]
  ): Promise<void> {
    const msg: InboundMessage = {
      channel: this.name,
      senderId,
      chatId,
      content,
      rawEvent,
      timestamp: new Date(),
      messageId,
      messageType,
      media
    };

    await this.eventBus.publishInbound(msg);
  }
}
