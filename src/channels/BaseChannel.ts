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

  /**
   * 验证消息是否为空
   * @returns true 如果消息有效，false 如果消息为空
   */
  protected validateMessage(msg: OutboundMessage): boolean {
    const hasContent = msg.content && msg.content.trim().length > 0;
    const hasMedia = msg.media && msg.media.length > 0;

    if (!hasContent && !hasMedia) {
      this.log.error(`[${this.name}] Attempted to send empty message (no content and no media) to ${msg.messageType || 'private'}:${msg.chatId}`);
      return false;
    }

    return true;
  }

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
