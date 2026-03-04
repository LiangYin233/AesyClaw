import { EventEmitter } from 'events';
import type { InboundMessage, OutboundMessage, EventType } from '../types.js';
import { CONSTANTS } from '../constants/index.js';

const MAX_QUEUE_SIZE = CONSTANTS.QUEUE_SIZE;

export class EventBus extends EventEmitter {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundReadIndex = 0;
  private outboundReadIndex = 0;
  private inboundResolver: ((msg: InboundMessage) => void) | null = null;
  private outboundResolver: ((msg: OutboundMessage) => void) | null = null;

  private popFromQueue<T>(queue: T[], readIndex: number): { item: T | undefined; newReadIndex: number } {
    if (readIndex >= queue.length) {
      return { item: undefined, newReadIndex: readIndex };
    }
    return { item: queue[readIndex], newReadIndex: readIndex + 1 };
  }

  async publishInbound(msg: InboundMessage): Promise<void> {
    this.emit('inbound', msg);

    if (this.inboundResolver) {
      const resolver = this.inboundResolver;
      this.inboundResolver = null;
      resolver(msg);
      return;
    }

    if (this.inboundQueue.length - this.inboundReadIndex >= MAX_QUEUE_SIZE) {
      const itemsToRemove = Math.floor(MAX_QUEUE_SIZE / 4);
      this.inboundQueue.splice(0, this.inboundReadIndex + itemsToRemove);
      this.inboundReadIndex = 0;
    }
    this.inboundQueue.push(msg);
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    this.emit('outbound', msg);

    if (this.outboundResolver) {
      const resolver = this.outboundResolver;
      this.outboundResolver = null;
      resolver(msg);
      return;
    }

    if (this.outboundQueue.length - this.outboundReadIndex >= MAX_QUEUE_SIZE) {
      const itemsToRemove = Math.floor(MAX_QUEUE_SIZE / 4);
      this.outboundQueue.splice(0, this.outboundReadIndex + itemsToRemove);
      this.outboundReadIndex = 0;
    }
    this.outboundQueue.push(msg);
  }

  async consumeInbound(): Promise<InboundMessage> {
    const result = this.popFromQueue(this.inboundQueue, this.inboundReadIndex);
    if (result.item) {
      this.inboundReadIndex = result.newReadIndex;
      return result.item;
    }

    return new Promise<InboundMessage>((resolve) => {
      this.inboundResolver = resolve;
    });
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    const result = this.popFromQueue(this.outboundQueue, this.outboundReadIndex);
    if (result.item) {
      this.outboundReadIndex = result.newReadIndex;
      return result.item;
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
