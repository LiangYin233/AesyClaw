import { EventEmitter } from 'events';
import type { InboundMessage, OutboundMessage, EventType } from '../types.js';

const MAX_QUEUE_SIZE = 1000;

export class EventBus extends EventEmitter {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundResolver: ((msg: InboundMessage) => void) | null = null;
  private outboundResolver: ((msg: OutboundMessage) => void) | null = null;

  async publishInbound(msg: InboundMessage): Promise<void> {
    if (this.inboundQueue.length >= MAX_QUEUE_SIZE) {
      this.inboundQueue.shift();
    }
    this.inboundQueue.push(msg);
    this.emit('inbound', msg);

    if (this.inboundResolver) {
      const resolver = this.inboundResolver;
      this.inboundResolver = null;
      resolver(msg);
    }
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    if (this.outboundQueue.length >= MAX_QUEUE_SIZE) {
      this.outboundQueue.shift();
    }
    this.outboundQueue.push(msg);
    this.emit('outbound', msg);

    if (this.outboundResolver) {
      const resolver = this.outboundResolver;
      this.outboundResolver = null;
      resolver(msg);
    }
  }

  async consumeInbound(): Promise<InboundMessage> {
    const msg = this.inboundQueue.shift();
    if (msg) {
      return msg;
    }

    return new Promise<InboundMessage>((resolve) => {
      this.inboundResolver = resolve;
    });
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    const msg = this.outboundQueue.shift();
    if (msg) {
      return msg;
    }

    return new Promise<OutboundMessage>((resolve) => {
      this.outboundResolver = resolve;
    });
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }
}
