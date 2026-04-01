/**
 * 适配器接口定义
 * 
 * 为适配器开发者设计的简单接口。
 * 框架负责处理复杂逻辑，适配器只关注平台特定实现。
 */

import { UnifiedMessage } from './unified-message.js';

/**
 * 适配器运行时上下文
 * 启动时由框架注入
 */
export interface AdapterContext {
  /** 工作区根目录 */
  workspace: string;
  /** 资源存储目录 */
  assetsRoot: string;
  /** 
   * 上报入站消息（适配器调用）
   * 框架会自动处理资源下载、格式转换等
   */
  reportIncoming: (message: UnifiedMessage) => Promise<void>;
}

/**
 * 发送结果
 */
export interface SendResult {
  /** 平台消息 ID（发送成功后返回） */
  messageId?: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
}

/**
 * 通道适配器接口
 * 
 * 适配器开发者只需要实现这 5 个方法：
 * 1. name - 适配器名称
 * 2. start - 启动适配器（建立连接）
 * 3. stop - 停止适配器（关闭连接）
 * 4. parseEvent - 解析平台事件为统一消息
 * 5. send - 发送统一消息到平台
 * 6. classifyError - 分类错误（用于重试策略，可选）
 */
export interface ChannelAdapter {
  /** 适配器名称（唯一标识） */
  readonly name: string;

  /**
   * 启动适配器
   * 建立连接（WebSocket/HTTP）、设置监听器等
   * 
   * @param context - 运行时上下文
   */
  start(context: AdapterContext): Promise<void>;

  /**
   * 停止适配器
   * 关闭连接、清理资源
   */
  stop(): Promise<void>;

  /**
   * 解析平台事件为统一消息
   * 
   * @param rawEvent - 平台原始事件（OneBot JSON / 飞书 Webhook 等）
   * @returns 统一消息，返回 null 表示忽略此事件
   * 
   * 💡 提示：使用 BaseChannelAdapter 提供的辅助方法简化实现
   */
  parseEvent(rawEvent: unknown): Promise<UnifiedMessage | null>;

  /**
   * 发送统一消息到平台
   * 
   * @param message - 统一消息（框架已处理好资源本地化）
   * @returns 发送结果
   * 
   * 💡 提示：使用 BaseChannelAdapter 提供的辅助方法简化实现
   */
  send(message: UnifiedMessage): Promise<SendResult>;

  /**
   * 错误分类
   * 用于框架决定是否需要重试
   * 
   * @returns retryable - 是否可重试
   * @returns message - 错误描述
   */
  classifyError(error: unknown): { retryable: boolean; message: string };
}

/**
 * 适配器构造器
 * 用于动态创建适配器实例
 */
export type AdapterConstructor = new (...args: unknown[]) => ChannelAdapter;
