import { EventEmitter } from 'events';
import type { InboundMessage, OutboundMessage, EventType } from '../types.js';
import { CONSTANTS } from '../constants/index.js';

const MAX_QUEUE_SIZE = CONSTANTS.QUEUE_SIZE;

interface QueueItem<T> {
  data: T;
  timestamp: number;
}

export class EventBus extends EventEmitter {
  private inboundQueue: QueueItem<InboundMessage>[] = [];
  private outboundQueue: QueueItem<OutboundMessage>[] = [];
  private inboundWaiter: ((msg: InboundMessage) => void) | null = null;
  private outboundWaiter: ((msg: OutboundMessage) => void) | null = null;

  private popFromQueue<T>(queue: QueueItem<T>[]): T | undefined {
    if (queue.length === 0) {
      return undefined;
    }
    return queue.shift()?.data;
  }

  private trimQueue<T>(queue: QueueItem<T>[]): void {
    if (queue.length >= MAX_QUEUE_SIZE) {
      const itemsToRemove = Math.floor(MAX_QUEUE_SIZE / 4);
      queue.splice(0, itemsToRemove);
    }
  }

  async publishInbound(msg: InboundMessage): Promise<void> {
    this.emit('inbound', msg);

    if (this.inboundWaiter) {
      const waiter = this.inboundWaiter;
      this.inboundWaiter = null;
      waiter(msg);
      return;
    }

    this.trimQueue(this.inboundQueue);
    this.inboundQueue.push({ data: msg, timestamp: Date.now() });
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    this.emit('outbound', msg);

    if (this.outboundWaiter) {
      const waiter = this.outboundWaiter;
      this.outboundWaiter = null;
      waiter(msg);
      return;
    }

    this.trimQueue(this.outboundQueue);
    this.outboundQueue.push({ data: msg, timestamp: Date.now() });
  }

  async consumeInbound(): Promise<InboundMessage> {
    const item = this.popFromQueue(this.inboundQueue);
    if (item !== undefined) {
      return item;
    }

    return new Promise<InboundMessage>((resolve) => {
      this.inboundWaiter = resolve;
    });
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    const item = this.popFromQueue(this.outboundQueue);
    if (item !== undefined) {
      return item;
    }

    return new Promise<OutboundMessage>((resolve) => {
      this.outboundWaiter = resolve;
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
