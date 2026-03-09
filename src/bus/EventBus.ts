import { EventEmitter } from 'events';
import type { InboundMessage, OutboundMessage } from '../types.js';
import { CONSTANTS } from '../constants/index.js';

const MAX_QUEUE_SIZE = CONSTANTS.QUEUE_SIZE;

export type StopHandler = (channel: string, chatId: string) => boolean;

export class EventBus extends EventEmitter {
  private inboundQueue: InboundMessage[] = [];
  private inboundWaiter: ((msg: InboundMessage) => void) | null = null;
  private stopHandler: StopHandler | null = null;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * 设置停止命令处理器
   */
  setStopHandler(handler: StopHandler): void {
    this.stopHandler = handler;
  }

  publishInbound(msg: InboundMessage): void {
    // 检查是否是 stop 命令
    if (this.stopHandler && msg.content === '/stop') {
      const handled = this.stopHandler(msg.channel, msg.chatId);
      if (handled) {
        this.emit('stop', msg);
        return;
      }
    }

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
  }

  consumeInbound(): Promise<InboundMessage> {
    const item = this.inboundQueue.shift();
    if (item) return Promise.resolve(item);
    return new Promise(resolve => { this.inboundWaiter = resolve; });
  }
}
