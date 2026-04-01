/**
 * 通道运行时
 * 
 * 核心职责：
 * 1. 管理适配器生命周期
 * 2. 处理消息转换（透明化，Agent 和 Adapter 都不需要关心）
 * 3. 管理消息队列
 */

import { ChannelAdapter, AdapterContext, SendResult } from '../protocol/adapter-interface.js';
import { UnifiedMessage } from '../protocol/unified-message.js';
import { MessageQueue } from './MessageQueue.js';
import { EventEmitter } from 'events';
import { logger } from '../../../../platform/observability/index.js';

/**
 * 运行时选项
 */
export interface RuntimeOptions {
  /** 工作区目录 */
  workspace: string;
  /** 资源存储目录 */
  assetsRoot: string;
  /** 是否启用队列（默认 true） */
  enableQueue?: boolean;
}

/**
 * 入站消息处理器
 */
export type IncomingMessageHandler = (message: UnifiedMessage) => Promise<void> | void;

/**
 * 通道运行时
 */
export class ChannelRuntime extends EventEmitter {
  private adapters = new Map<string, ChannelAdapter>();
  private runningAdapters = new Map<string, boolean>();
  private options: Required<RuntimeOptions>;
  private handler?: IncomingMessageHandler;
  private queue: MessageQueue;
  
  constructor(options: RuntimeOptions) {
    super();
    this.options = {
      workspace: options.workspace,
      assetsRoot: options.assetsRoot,
      enableQueue: options.enableQueue ?? true
    };
    this.queue = new MessageQueue({ enabled: this.options.enableQueue });
  }
  
  /**
   * 注册适配器
   * 
   * @param adapter - 适配器实例
   */
  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.name, adapter);
    this.emit('adapter:registered', adapter.name);
  }
  
  /**
   * 注销适配器
   * 
   * @param name - 适配器名称
   */
  unregisterAdapter(name: string): boolean {
    const deleted = this.adapters.delete(name);
    if (deleted) {
      this.emit('adapter:unregistered', name);
    }
    return deleted;
  }
  
  /**
   * 设置入站消息处理器
   * 
   * @param handler - 处理函数
   */
  setIncomingHandler(handler: IncomingMessageHandler): void {
    this.handler = handler;
  }
  
  /**
   * 启动适配器
   *
   * @param name - 适配器名称
   * @param config - 通道配置（从 config.toml 读取）
   */
  async startAdapter(name: string, config?: Record<string, unknown>): Promise<void> {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(`Adapter not found: ${name}`);
    }

    const enabled = config?.enabled === true;
    if (!enabled) {
      if (config === undefined) {
        logger.debug(`跳过未配置的通道`, { channel: name });
      } else {
        logger.debug(`跳过禁用的通道`, { channel: name });
      }
      return;
    }

    const context: AdapterContext = {
      workspace: this.options.workspace,
      assetsRoot: this.options.assetsRoot,
      config,
      reportIncoming: (message) => this.handleIncomingMessage(name, message)
    };

    await adapter.start(context);
    this.runningAdapters.set(name, true);
    this.emit('adapter:started', name);
  }
  
  /**
   * 停止适配器
   * 
   * @param name - 适配器名称
   */
  async stopAdapter(name: string): Promise<void> {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      return;
    }

    await adapter.stop();
    this.runningAdapters.set(name, false);
    this.emit('adapter:stopped', name);
  }
  
  /**
   * 发送消息
   * 
   * @param message - 要发送的消息
   * @returns 发送结果
   */
  async send(message: UnifiedMessage): Promise<SendResult> {
    const adapter = this.adapters.get(message.channel);
    if (!adapter) {
      return { 
        success: false, 
        error: `Channel not found: ${message.channel}` 
      };
    }
    
    try {
      // 使用队列发送
      const result = await this.queue.enqueue(message, (msg) => adapter.send(msg));
      
      if (result.success) {
        this.emit('message:sent', message, result);
      } else {
        this.emit('message:failed', message, result.error);
      }
      
      return result;
    } catch (error) {
      const message_text = error instanceof Error ? error.message : String(error);
      this.emit('message:failed', message, message_text);
      return { success: false, error: message_text };
    }
  }
  
  /**
   * 获取适配器
   * 
   * @param name - 适配器名称
   * @returns 适配器实例
   */
  getAdapter(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }
  
  /**
   * 获取所有适配器名称
   * 
   * @returns 适配器名称列表
   */
  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }
  
  /**
   * 获取适配器状态
   * 
   * @returns 适配器名称到运行状态的映射
   */
  getAdapterStatus(): Map<string, boolean> {
    return new Map(this.runningAdapters);
  }
  
  /**
   * 获取队列长度
   */
  getQueueLength(): number {
    return this.queue.length;
  }
  
  /**
   * 清空发送队列
   */
  clearQueue(): void {
    this.queue.clear();
  }
  
  /**
   * 处理入站消息
   * 
   * @param channel - 通道名称
   * @param message - 消息
   */
  private async handleIncomingMessage(channel: string, message: UnifiedMessage): Promise<void> {
    // 补充通道信息
    message.channel = channel;
    message.direction = 'inbound';
    
    this.emit('message:received', message);
    
    // 交给 Agent 处理
    if (this.handler) {
      try {
        await this.handler(message);
      } catch (error) {
        this.emit('handler:error', message, error);
      }
    }
  }
}

/**
 * 创建运行时实例
 * 
 * @param options - 运行时选项
 * @returns 运行时实例
 */
export function createChannelRuntime(options: RuntimeOptions): ChannelRuntime {
  return new ChannelRuntime(options);
}
