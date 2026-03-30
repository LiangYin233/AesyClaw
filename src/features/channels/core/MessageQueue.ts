/**
 * 消息发送队列（简化版）
 * 
 * 提供发送队列、重试机制、幂等性保证。
 */

import { UnifiedMessage } from '../protocol/unified-message.js';
import { SendResult } from '../protocol/adapter-interface.js';

/**
 * 队列选项
 */
export interface QueueOptions {
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 重试延迟（毫秒，默认 1000） */
  retryDelayMs?: number;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/**
 * 队列项
 */
interface QueueItem {
  message: UnifiedMessage;
  resolve: (result: SendResult) => void;
  reject: (error: Error) => void;
  attempts: number;
}

/**
 * 消息发送队列
 * 
 * 职责：
 * 1. 管理待发送消息队列
 * 2. 实现指数退避重试策略
 * 3. 保证幂等性（通过消息 ID）
 */
export class MessageQueue {
  private queue: QueueItem[] = [];
  private options: Required<QueueOptions>;
  private running = false;
  private processedIds = new Set<string>(); // 幂等性检查
  
  constructor(options: QueueOptions = {}) {
    this.options = {
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      enabled: options.enabled ?? true
    };
  }
  
  /**
   * 添加消息到队列
   * 
   * @param message - 要发送的消息
   * @param sender - 发送函数
   * @returns 发送结果
   */
  async enqueue(
    message: UnifiedMessage,
    sender: (msg: UnifiedMessage) => Promise<SendResult>
  ): Promise<SendResult> {
    // 幂等性检查
    if (this.processedIds.has(message.id)) {
      return { success: true, messageId: message.id };
    }
    
    if (!this.options.enabled) {
      // 队列禁用，直接发送
      return sender(message);
    }
    
    return new Promise((resolve, reject) => {
      this.queue.push({
        message,
        resolve,
        reject,
        attempts: 0
      });
      
      if (!this.running) {
        this.processQueue(sender);
      }
    });
  }
  
  /**
   * 清空队列
   */
  clear(): void {
    // 拒绝所有等待中的消息
    for (const item of this.queue) {
      item.reject(new Error('Queue cleared'));
    }
    this.queue = [];
  }
  
  /**
   * 获取队列长度
   */
  get length(): number {
    return this.queue.length;
  }
  
  /**
   * 处理队列
   */
  private async processQueue(
    sender: (msg: UnifiedMessage) => Promise<SendResult>
  ): Promise<void> {
    this.running = true;
    
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      
      try {
        const result = await sender(item.message);
        
        if (result.success) {
          // 发送成功，记录 ID 防止重复
          this.processedIds.add(item.message.id);
          item.resolve(result);
        } else if (item.attempts < this.options.maxRetries) {
          // 发送失败，重试
          item.attempts++;
          const delay = this.options.retryDelayMs * Math.pow(2, item.attempts - 1);
          await this.delay(delay);
          this.queue.unshift(item); // 放回队列头部
        } else {
          // 达到最大重试次数
          this.processedIds.add(item.message.id);
          item.resolve(result);
        }
      } catch (error) {
        if (item.attempts < this.options.maxRetries) {
          // 发生异常，重试
          item.attempts++;
          const delay = this.options.retryDelayMs * Math.pow(2, item.attempts - 1);
          await this.delay(delay);
          this.queue.unshift(item);
        } else {
          // 达到最大重试次数
          this.processedIds.add(item.message.id);
          item.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
    
    this.running = false;
  }
  
  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
