import { EventEmitter } from 'events';  // 事件发射器基类
import type { InboundMessage, OutboundMessage } from '../types.js';
import { CONSTANTS } from '../constants/index.js';

const MAX_QUEUE_SIZE = CONSTANTS.QUEUE_SIZE;  // 队列最大长度

interface QueueItem<T> {
  data: T;  // 消息数据
  timestamp: number;  // 时间戳
}

/**
 * Async Lock - Replaces busy-waiting with Promise queue
 */
class AsyncLock {
  private locked = false;
  private waiters: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    // Wait in queue
    return new Promise<void>(resolve => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Wake up next waiter
      next();
    } else {
      // No waiters, unlock
      this.locked = false;
    }
  }
}

export class EventBus extends EventEmitter {  // 事件总线类
  private inboundQueue: QueueItem<InboundMessage>[] = [];  // 入站消息队列
  private outboundQueue: QueueItem<OutboundMessage>[] = [];  // 出站消息队列
  private inboundWaiter: ((msg: InboundMessage) => void) | null = null;  // 入站消息等待者
  private outboundWaiter: ((msg: OutboundMessage) => void) | null = null;  // 出站消息等待者
  private inboundLock = new AsyncLock();
  private outboundLock = new AsyncLock();

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  private popFromQueue<T>(queue: QueueItem<T>[]): T | undefined {  // 从队列取出消息
    if (queue.length === 0) {
      return undefined;
    }
    return queue.shift()?.data;  // 移除并返回队首元素
  }

  private trimQueue<T>(queue: QueueItem<T>[]): void {  // 裁剪队列防止溢出
    if (queue.length >= MAX_QUEUE_SIZE) {
      const itemsToRemove = Math.floor(MAX_QUEUE_SIZE / 4);
      const newQueue = queue.slice(itemsToRemove);  // 创建新数组避免并发修改
      queue.length = 0;
      queue.push(...newQueue);
    }
  }

  async publishInbound(msg: InboundMessage): Promise<void> {  // 发布入站消息
    this.emit('inbound', msg);

    if (this.inboundWaiter) {  // 有等待者直接交付
      const waiter = this.inboundWaiter;
      this.inboundWaiter = null;
      waiter(msg);
      return;
    }

    await this.inboundLock.acquire();
    try {
      this.trimQueue(this.inboundQueue);  // 裁剪队列
      this.inboundQueue.push({ data: msg, timestamp: Date.now() });  // 加入队列
    } finally {
      this.inboundLock.release();
    }
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {  // 发布出站消息
    this.emit('outbound', msg);

    if (this.outboundWaiter) {  // 有等待者直接交付
      const waiter = this.outboundWaiter;
      this.outboundWaiter = null;
      waiter(msg);
      return;
    }

    await this.outboundLock.acquire();
    try {
      this.trimQueue(this.outboundQueue);  // 裁剪队列
      this.outboundQueue.push({ data: msg, timestamp: Date.now() });  // 加入队列
    } finally {
      this.outboundLock.release();
    }
  }

  async consumeInbound(): Promise<InboundMessage> {  // 消费入站消息
    await this.inboundLock.acquire();
    let item: InboundMessage | undefined;
    try {
      item = this.popFromQueue(this.inboundQueue);
    } finally {
      this.inboundLock.release();
    }

    if (item !== undefined) {
      return item;
    }

    return new Promise<InboundMessage>((resolve) => {  // 无消息时创建 Promise 等待
      this.inboundWaiter = resolve;
    });
  }

  async consumeOutbound(): Promise<OutboundMessage> {  // 消费出站消息
    await this.outboundLock.acquire();
    let item: OutboundMessage | undefined;
    try {
      item = this.popFromQueue(this.outboundQueue);
    } finally {
      this.outboundLock.release();
    }

    if (item !== undefined) {
      return item;
    }

    return new Promise<OutboundMessage>((resolve) => {  // 无消息时创建 Promise 等待
      this.outboundWaiter = resolve;
    });
  }

  emit(event: string | symbol, ...args: any[]): boolean {  // 发射事件
    return super.emit(event, ...args);
  }

  on(event: string | symbol, listener: (...args: any[]) => void): this {  // 注册事件监听器
    return super.on(event, listener);
  }

  once(event: string | symbol, listener: (...args: any[]) => void): this {  // 注册一次性监听器
    return super.once(event, listener);
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {  // 移除事件监听器
    return super.off(event, listener);
  }
}
