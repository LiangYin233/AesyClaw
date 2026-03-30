/**
 * 通道管理器
 * 
 * 高层 API，供应用层使用。
 */

import { ChannelRuntime, createChannelRuntime, RuntimeOptions, IncomingMessageHandler } from './core/ChannelRuntime.js';
import { ChannelAdapter } from './protocol/adapter-interface.js';
import { UnifiedMessage, createOutboundMessage, createTextMessage, createImageMessage } from './protocol/unified-message.js';
import { ImageAttachment, FileAttachment } from './protocol/attachment.js';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';

/**
 * 管理器选项
 */
export interface ManagerOptions extends RuntimeOptions {
  /** 适配器目录（默认 workspace/plugins） */
  adapterDir?: string;
}

/**
 * 通道状态
 */
export interface ChannelStatus {
  /** 通道名称 */
  name: string;
  /** 是否已连接 */
  connected: boolean;
}

/**
 * 发送文本消息选项
 */
export interface SendTextOptions {
  /** 回复的消息 ID */
  replyTo?: string;
}

/**
 * 发送图片消息选项
 */
export interface SendImageOptions {
  /**  accompanying text */
  text?: string;
  /** 回复的消息 ID */
  replyTo?: string;
}

/**
 * 通道管理器
 * 
 * 提供简化的 API 来管理通道和发送消息。
 * 
 * @example
 * ```typescript
 * const channels = new ChannelManager({
 *   workspace: process.cwd()
 * });
 * 
 * // 加载所有适配器
 * await channels.loadAdapters();
 * 
 * // 监听消息
 * channels.onMessage(async (message) => {
 *   console.log(`Received: ${message.text}`);
 *   await channels.sendText(message.channel, message.chatId, '收到！');
 * });
 * 
 * // 启动所有通道
 * await channels.startAll();
 * ```
 */
export class ChannelManager {
  private runtime: ChannelRuntime;
  private options: Required<ManagerOptions>;
  
  /**
   * 创建通道管理器
   * 
   * @param options - 管理器选项
   */
  constructor(options: ManagerOptions) {
    this.options = {
      workspace: options.workspace,
      assetsRoot: options.assetsRoot || join(options.workspace, 'assets'),
      enableQueue: options.enableQueue ?? true,
      adapterDir: options.adapterDir || join(options.workspace, 'plugins')
    };
    
    this.runtime = createChannelRuntime({
      workspace: this.options.workspace,
      assetsRoot: this.options.assetsRoot,
      enableQueue: this.options.enableQueue
    });
  }
  
  /**
   * 加载并注册所有适配器
   * 
   * 从 adapterDir 目录加载所有 channel_* 插件。
   * 
   * @param adapterDir - 适配器目录（可选，覆盖默认）
   * @returns 加载的适配器数量
   */
  async loadAdapters(adapterDir?: string): Promise<number> {
    const dir = adapterDir || this.options.adapterDir;
    let count = 0;
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('channel_')) continue;
        
        const mainPath = join(dir, entry.name, 'main.ts');
        try {
          // 动态导入
          const module = await import(pathToFileURL(mainPath).href);
          const adapter = module.default || module;
          
          if (this.isValidAdapter(adapter)) {
            this.runtime.registerAdapter(adapter);
            console.log(`[Channels] Registered adapter: ${adapter.name}`);
            count++;
          } else {
            console.warn(`[Channels] Invalid adapter: ${entry.name}`);
          }
        } catch (error) {
          console.warn(`[Channels] Failed to load adapter ${entry.name}:`, error);
        }
      }
    } catch (error) {
      console.warn(`[Channels] Failed to read adapter directory: ${error}`);
    }
    
    return count;
  }
  
  /**
   * 注册单个适配器
   * 
   * @param adapter - 适配器实例
   */
  registerAdapter(adapter: ChannelAdapter): void {
    this.runtime.registerAdapter(adapter);
  }
  
  /**
   * 注销适配器
   * 
   * @param name - 适配器名称
   * @returns 是否成功注销
   */
  unregisterAdapter(name: string): boolean {
    return this.runtime.unregisterAdapter(name);
  }
  
  /**
   * 启动指定通道
   * 
   * @param name - 通道名称
   */
  async startChannel(name: string): Promise<void> {
    await this.runtime.startAdapter(name);
  }
  
  /**
   * 停止指定通道
   * 
   * @param name - 通道名称
   */
  async stopChannel(name: string): Promise<void> {
    await this.runtime.stopAdapter(name);
  }
  
  /**
   * 启动所有通道
   */
  async startAll(): Promise<void> {
    const names = this.runtime.getAdapterNames();
    for (const name of names) {
      await this.startChannel(name);
    }
  }
  
  /**
   * 停止所有通道
   */
  async stopAll(): Promise<void> {
    const names = this.runtime.getAdapterNames();
    for (const name of names) {
      await this.stopChannel(name);
    }
  }
  
  /**
   * 发送消息
   * 
   * @param message - 完整消息
   * @returns 是否发送成功
   */
  async send(message: UnifiedMessage): Promise<boolean> {
    const result = await this.runtime.send(message);
    return result.success;
  }

  /**
   * 发送消息（兼容旧 API）
   * 
   * @param message - 出站消息（兼容 OutboundMessage 格式）
   * @returns 投递回执
   */
  async dispatch(message: { channel: string; chatId: string; content: string; media?: string[]; files?: string[]; replyTo?: string }): Promise<{ jobId: string; status: string }> {
    const unifiedMessage: UnifiedMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      channel: message.channel,
      direction: 'outbound',
      chatId: message.chatId,
      chatType: 'private',
      senderId: '',
      text: message.content,
      images: message.media?.map(url => ({ id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, type: 'image' as const, name: 'image.png', url })) || [],
      files: message.files?.map(url => {
        const name = url.split('/').pop() || 'file';
        const type = this.detectFileType(name);
        return { id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, type, name, url };
      }) || [],
      replyTo: message.replyTo,
      timestamp: new Date()
    };

    const result = await this.runtime.send(unifiedMessage);
    return {
      jobId: unifiedMessage.id,
      status: result.success ? 'sent' : 'failed'
    };
  }

  private detectFileType(filename: string): 'file' | 'audio' | 'video' {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const audioExts = ['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'amr', 'aac', 'wma'];
    const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v'];
    
    if (audioExts.includes(ext)) return 'audio';
    if (videoExts.includes(ext)) return 'video';
    return 'file';
  }
  
  /**
   * 快速发送文本消息
   * 
   * @param channel - 通道名称
   * @param chatId - 聊天会话 ID
   * @param text - 消息内容
   * @param options - 发送选项
   * @returns 是否发送成功
   * 
   * @example
   * ```typescript
   * await channels.sendText('onebot', '123456', '你好！');
   * ```
   */
  async sendText(
    channel: string, 
    chatId: string, 
    text: string,
    options?: SendTextOptions
  ): Promise<boolean> {
    const message = createOutboundMessage({
      channel,
      chatId,
      text,
      replyTo: options?.replyTo
    });
    return this.send(message);
  }
  
  /**
   * 发送图片消息
   * 
   * @param channel - 通道名称
   * @param chatId - 聊天会话 ID
   * @param imageUrl - 图片 URL（本地路径或远程 URL）
   * @param options - 发送选项
   * @returns 是否发送成功
   * 
   * @example
   * ```typescript
   * await channels.sendImage('onebot', '123456', 'https://example.com/pic.jpg');
   * await channels.sendImage('onebot', '123456', '/path/to/local.jpg', { text: '看图' });
   * ```
   */
  async sendImage(
    channel: string,
    chatId: string,
    imageUrl: string,
    options?: SendImageOptions
  ): Promise<boolean> {
    const message = createImageMessage(channel, chatId, imageUrl, options?.text);
    if (options?.replyTo) {
      message.replyTo = options.replyTo;
    }
    return this.send(message);
  }
  
  /**
   * 发送带附件的消息
   * 
   * @param channel - 通道名称
   * @param chatId - 聊天会话 ID
   * @param text - 消息内容
   * @param images - 图片附件
   * @param files - 文件附件
   * @returns 是否发送成功
   */
  async sendWithAttachments(
    channel: string,
    chatId: string,
    text: string,
    images?: ImageAttachment[],
    files?: FileAttachment[]
  ): Promise<boolean> {
    const message = createOutboundMessage({
      channel,
      chatId,
      text,
      images: images || [],
      files: files || []
    });
    return this.send(message);
  }
  
  /**
   * 设置入站消息处理器
   * 
   * @param handler - 处理函数
   */
  onMessage(handler: IncomingMessageHandler): void {
    this.runtime.setIncomingHandler(handler);
  }
  
  /**
   * 监听事件
   * 
   * @param event - 事件名称
   * @param handler - 处理函数
   */
  on<E extends keyof ChannelManagerEvents>(
    event: E,
    handler: ChannelManagerEvents[E]
  ): void {
    this.runtime.on(event as string, handler as any);
  }
  
  /**
   * 获取通道状态
   * 
   * @returns 通道状态列表
   */
  getStatus(): ChannelStatus[] {
    const status: ChannelStatus[] = [];
    for (const [name, connected] of this.runtime.getAdapterStatus()) {
      status.push({ name, connected });
    }
    return status;
  }
  
  /**
   * 获取队列长度
   * 
   * @returns 待发送消息数量
   */
  getQueueLength(): number {
    return this.runtime.getQueueLength();
  }
  
  /**
   * 清空发送队列
   */
  clearQueue(): void {
    this.runtime.clearQueue();
  }
  
  /**
   * 验证适配器
   */
  private isValidAdapter(value: unknown): value is ChannelAdapter {
    return !!value &&
           typeof value === 'object' &&
           typeof (value as ChannelAdapter).name === 'string' &&
           typeof (value as ChannelAdapter).start === 'function' &&
           typeof (value as ChannelAdapter).stop === 'function' &&
           typeof (value as ChannelAdapter).parseEvent === 'function' &&
           typeof (value as ChannelAdapter).send === 'function';
  }
}

/**
 * 通道管理器事件
 */
interface ChannelManagerEvents {
  /** 适配器已注册 */
  'adapter:registered': (name: string) => void;
  /** 适配器已启动 */
  'adapter:started': (name: string) => void;
  /** 适配器已停止 */
  'adapter:stopped': (name: string) => void;
  /** 消息已接收 */
  'message:received': (message: UnifiedMessage) => void;
  /** 消息已发送 */
  'message:sent': (message: UnifiedMessage, result: { messageId?: string }) => void;
  /** 消息发送失败 */
  'message:failed': (message: UnifiedMessage, error: string) => void;
  /** 处理错误 */
  'handler:error': (message: UnifiedMessage, error: unknown) => void;
}
