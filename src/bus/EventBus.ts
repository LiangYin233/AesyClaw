import { EventEmitter } from 'events';
import type { InboundMessage, OutboundMessage } from '../types.js';
import { CONSTANTS } from '../constants/index.js';

const MAX_QUEUE_SIZE = CONSTANTS.QUEUE_SIZE;

export class EventBus extends EventEmitter {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundWaiter: ((msg: InboundMessage) => void) | null = null;
  private outboundWaiter: ((msg: OutboundMessage) => void) | null = null;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  publishInbound(msg: InboundMessage): void {
    this.emit('inbound', msg);

    if (this.inboundWaiter) {
      const waiter = this.inboundWaiter;
      this.inboundWaiter = null;
      waiter(msg);
      return;
    }

    if (this.inboundQueue.length >= MAX_QUEUE_SIZE) {
      this.inboundQueue.splice(0, Math.floor(MAX_QUEUE_SIZE / 4));
    }
    this.inboundQueue.push(msg);
  }

  publishOutbound(msg: OutboundMessage): void {
    this.emit('outbound', msg);

    if (this.outboundWaiter) {
      const waiter = this.outboundWaiter;
      this.outboundWaiter = null;
      waiter(msg);
      return;
    }

    if (this.outboundQueue.length >= MAX_QUEUE_SIZE) {
      this.outboundQueue.splice(0, Math.floor(MAX_QUEUE_SIZE / 4));
    }
    this.outboundQueue.push(msg);
  }

  consumeInbound(): Promise<InboundMessage> {
    const item = this.inboundQueue.shift();
    if (item) return Promise.resolve(item);
    return new Promise(resolve => { this.inboundWaiter = resolve; });
  }

  consumeOutbound(): Promise<OutboundMessage> {
    const item = this.outboundQueue.shift();
    if (item) return Promise.resolve(item);
    return new Promise(resolve => { this.outboundWaiter = resolve; });
  }
}
