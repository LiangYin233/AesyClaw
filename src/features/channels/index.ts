/**
 * Channels 模块
 * 
 * AesyClaw 的统一消息通道系统。
 * 
 * 核心特性：
 * - UnifiedMessage：Agent 看到的唯一消息类型
 * - ChannelAdapter：简单的适配器接口
 * - BaseChannelAdapter：提供丰富辅助方法的基类
 * - ChannelManager：简化的管理 API
 * 
 * @example
 * ```typescript
 * import { ChannelManager } from './channels/index.js';
 * 
 * const channels = new ChannelManager({
 *   workspace: process.cwd()
 * });
 * 
 * await channels.loadAdapters();
 * 
 * channels.onMessage(async (message) => {
 *   console.log(`[${message.channel}] ${message.senderName}: ${message.text}`);
 *   await channels.sendText(message.channel, message.chatId, '收到！');
 * });
 * 
 * await channels.startAll();
 * ```
 */

// ========== 协议层（核心类型） ==========

export type {
  UnifiedMessage,
  MessageDirection,
  ChatType,
  CreateOutboundMessageOptions
} from './protocol/unified-message.js';

export type {
  ImageAttachment,
  FileAttachment,
  BaseAttachment,
  FileType
} from './protocol/attachment.js';

export type {
  ChannelAdapter,
  AdapterContext,
  SendResult,
  AdapterConstructor
} from './protocol/adapter-interface.js';

export {
  createOutboundMessage,
  createInboundMessage,
  createTextMessage,
  createImageMessage
} from './protocol/unified-message.js';

export {
  createImageAttachment,
  createFileAttachment,
  isImageAttachment,
  isFileAttachment
} from './protocol/attachment.js';

// ========== 适配器开发工具 ==========

export {
  BaseChannelAdapter,
  createAdapter
} from './adapter/BaseChannelAdapter.js';

export type {
  BaseAdapterOptions
} from './adapter/BaseChannelAdapter.js';

export {
  // 辅助函数
  attachmentFromUrl,
  attachmentFromPath,
  attachmentFromBase64,
  composeText,
  parseCommand,
  truncateText,
  sanitizeText,
  extractUrls,
  // 工具函数
  detectFileType,
  isImageFile,
  isImageUrl
} from './adapter/adapter-helpers.js';

// ========== 核心运行时 ==========

export {
  ChannelRuntime,
  createChannelRuntime,
  MessageQueue
} from './core/index.js';

export type {
  RuntimeOptions,
  IncomingMessageHandler,
  QueueOptions
} from './core/index.js';

// ========== 管理器（最常用） ==========

export {
  ChannelManager
} from './ChannelManager.js';

export type {
  ManagerOptions,
  ChannelStatus,
  SendTextOptions,
  SendImageOptions
} from './ChannelManager.js';
