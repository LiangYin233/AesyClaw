/**
 * 适配器基类
 * 
 * 为适配器开发者提供的"瑞士军刀"。
 * 包含默认实现和大量辅助方法，大幅降低开发门槛。
 */

import { ChannelAdapter, AdapterContext, SendResult } from '../protocol/adapter-interface.js';
import { UnifiedMessage } from '../protocol/unified-message.js';
import { FileType } from '../protocol/attachment.js';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * 适配器配置选项
 */
export interface BaseAdapterOptions {
  /** 工作区目录 */
  workspace: string;
  /** 资源存储目录 */
  assetsRoot: string;
  /** 下载超时（毫秒，默认 30000） */
  downloadTimeout?: number;
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
}

/**
 * 适配器基类
 * 
 * 使用示例：
 * ```typescript
 * class OneBotAdapter extends BaseChannelAdapter {
 *   async onStart() {
 *     // 连接 WebSocket
 *   }
 *   
 *   async onStop() {
 *     // 断开连接
 *   }
 *   
 *   async parsePlatformEvent(event) {
 *     // 解析 OneBot 事件为 UnifiedMessage
 *     return {
 *       id: event.message_id,
 *       channel: 'onebot',
 *       direction: 'inbound',
 *       chatId: event.group_id || event.user_id,
 *       chatType: event.message_type === 'group' ? 'group' : 'private',
 *       senderId: event.user_id,
 *       text: this.extractText(event.message),
 *       images: await this.extractImages(event.message),
 *       files: [],
 *       timestamp: new Date(event.time * 1000)
 *     };
 *   }
 *   
 *   async sendToPlatform(message) {
 *     // 调用 OneBot API 发送消息
 *   }
 * }
 * ```
 */
export abstract class BaseChannelAdapter implements ChannelAdapter {
  abstract readonly name: string;
  
  protected context?: AdapterContext;
  protected options: BaseAdapterOptions;
  
  constructor(options?: Partial<BaseAdapterOptions>) {
    this.options = {
      workspace: options?.workspace || process.cwd(),
      assetsRoot: options?.assetsRoot || join(process.cwd(), 'assets'),
      downloadTimeout: options?.downloadTimeout || 30000,
      maxRetries: options?.maxRetries || 3
    };
  }
  
  // ========== 生命周期（子类可覆盖） ==========
  
  async start(context: AdapterContext): Promise<void> {
    this.context = context;
    await this.onStart();
  }
  
  async stop(): Promise<void> {
    await this.onStop();
  }
  
  /** 
   * 子类实现：启动逻辑（建立连接等）
   */
  protected abstract onStart(): Promise<void>;
  
  /** 
   * 子类实现：停止逻辑（关闭连接等）
   */
  protected abstract onStop(): Promise<void>;
  
  // ========== 核心方法（子类必须实现） ==========
  
  /**
   * 子类实现：解析平台事件
   * 这是适配器开发者的主要工作
   */
  protected abstract parsePlatformEvent(rawEvent: unknown): Promise<UnifiedMessage | null>;
  
  /**
   * 子类实现：发送到平台
   * 这是适配器开发者的主要工作
   */
  protected abstract sendToPlatform(message: UnifiedMessage): Promise<SendResult>;
  
  // ========== 框架调用（子类无需覆盖） ==========
  
  async parseEvent(rawEvent: unknown): Promise<UnifiedMessage | null> {
    const message = await this.parsePlatformEvent(rawEvent);
    if (!message) return null;
    
    // 框架自动处理资源下载
    await this.hydrateAttachments(message);
    
    return message;
  }
  
  async send(message: UnifiedMessage): Promise<SendResult> {
    // 框架自动确保资源本地化
    await this.localizeAttachments(message);
    
    return this.sendToPlatform(message);
  }
  
  classifyError(error: unknown): { retryable: boolean; message: string } {
    const message = error instanceof Error ? error.message : String(error);
    
    // 默认策略：网络错误可重试，其他不可重试
    const retryable = 
      message.includes('ETIMEDOUT') ||
      message.includes('ECONNRESET') ||
      message.includes('socket hang up') ||
      message.includes('timeout') ||
      message.includes('ECONNREFUSED');
    
    return { retryable, message };
  }
  
  // ========== 辅助方法（子类可用） ==========
  
  /**
   * 提取纯文本
   * 从复杂的消息格式中提取纯文本（支持 OneBot 的 message chain、飞书的 post 格式等）
   * 
   * @param content - 消息内容（可能是字符串、数组等）
   * @returns 纯文本
   */
  protected extractText(content: unknown): string {
    // 默认实现：如果是字符串直接返回
    if (typeof content === 'string') return content;
    
    // 如果是数组（OneBot message chain），提取 text 类型
    if (Array.isArray(content)) {
      return content
        .filter((seg: any) => seg.type === 'text' || seg.type === 'plain')
        .map((seg: any) => seg.data?.text || seg.text || seg.content || '')
        .join('');
    }
    
    return '';
  }
  
  /**
   * 提取 @提及
   * 从消息内容中提取 @用户
   * 
   * @param content - 消息内容
   * @returns 被提及的用户 ID 列表
   */
  protected extractMentions(content: unknown): string[] {
    const mentions: string[] = [];
    
    if (Array.isArray(content)) {
      for (const seg of content) {
        if (seg.type === 'at' && seg.data?.qq) {
          mentions.push(seg.data.qq);
        } else if (seg.type === 'mention' && seg.data?.user_id) {
          mentions.push(seg.data.user_id);
        }
      }
    }
    
    return mentions;
  }
  
  /**
   * 下载远程资源到本地
   * 
   * @param url - 远程 URL
   * @param filename - 目标文件名
   * @returns 本地文件路径
   */
  protected async downloadResource(url: string, filename: string): Promise<string> {
    const targetDir = join(this.options.assetsRoot, 'downloads', this.name);
    await mkdir(targetDir, { recursive: true });
    
    const targetPath = join(targetDir, filename);
    
    // 下载并保存
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.downloadTimeout);
    
    try {
      const response = await fetch(url, {
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(targetPath, buffer);
      
      return targetPath;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }
  
  /**
   * 保存 Base64 数据为文件
   * 
   * @param base64Data - Base64 编码的数据
   * @param filename - 文件名
   * @returns 本地文件路径
   */
  protected async saveBase64File(base64Data: string, filename: string): Promise<string> {
    const targetDir = join(this.options.assetsRoot, 'downloads', this.name);
    await mkdir(targetDir, { recursive: true });
    
    const targetPath = join(targetDir, filename);
    const buffer = Buffer.from(base64Data, 'base64');
    await writeFile(targetPath, buffer);
    
    return targetPath;
  }
  
  /**
   * 检测文件类型（根据扩展名）
   * 
   * @param filename - 文件名
   * @returns 文件类型
   */
  protected detectFileType(filename: string): FileType {
    const ext = filename.toLowerCase().split('.').pop() || '';
    
    const audioExts = ['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'amr', 'aac', 'wma'];
    const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg'];
    
    if (audioExts.includes(ext)) return 'audio';
    if (videoExts.includes(ext)) return 'video';
    
    return 'file';
  }
  
  /**
   * 检测是否为图片文件
   */
  protected isImageFile(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
    return imageExts.includes(ext);
  }
  
  /**
   * 生成唯一 ID
   */
  protected generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  
  // ========== 私有方法 ==========
  
  private async hydrateAttachments(message: UnifiedMessage): Promise<void> {
    // 下载所有远程附件到本地
    for (const image of message.images) {
      if (image.url.startsWith('http')) {
        const filename = `${image.id}_${image.name}`;
        try {
          image.url = await this.downloadResource(image.url, filename);
        } catch (error) {
          // 下载失败保留原 URL，让后续处理决定
          console.warn(`[${this.name}] Failed to download image: ${image.url}`, error);
        }
      }
    }
    
    for (const file of message.files) {
      if (file.url.startsWith('http')) {
        const filename = `${file.id}_${file.name}`;
        try {
          file.url = await this.downloadResource(file.url, filename);
        } catch (error) {
          console.warn(`[${this.name}] Failed to download file: ${file.url}`, error);
        }
      }
    }
  }
  
  private async localizeAttachments(message: UnifiedMessage): Promise<void> {
    // 确保所有附件都在本地（逻辑同上，用于发送前）
    await this.hydrateAttachments(message);
  }
}

/**
 * 创建简单适配器的工厂函数
 * 适用于简单场景，无需继承基类
 * 
 * @example
 * const adapter = createAdapter({
 *   name: 'simple',
 *   onStart: async (ctx) => { ... },
 *   onStop: async () => { ... },
 *   parseEvent: async (event) => { ... },
 *   send: async (message) => { ... }
 * });
 */
export function createAdapter(options: {
  name: string;
  onStart: (ctx: AdapterContext) => Promise<void>;
  onStop: () => Promise<void>;
  parseEvent: (event: unknown) => Promise<UnifiedMessage | null>;
  send: (message: UnifiedMessage) => Promise<SendResult>;
  classifyError?: (error: unknown) => { retryable: boolean; message: string };
}): ChannelAdapter {
  return {
    name: options.name,
    start: options.onStart,
    stop: options.onStop,
    parseEvent: options.parseEvent,
    send: options.send,
    classifyError: options.classifyError || ((error) => ({
      retryable: false,
      message: error instanceof Error ? error.message : String(error)
    }))
  };
}
