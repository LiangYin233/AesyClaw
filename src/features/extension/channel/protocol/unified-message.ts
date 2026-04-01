/**
 * 统一消息协议
 * 
 * 这是 Agent 看到的唯一消息类型。
 * 简单、清晰、直接可用。
 */

import { ImageAttachment, FileAttachment, createImageAttachment, createFileAttachment } from './attachment.js';

export type { ImageAttachment, FileAttachment };
export { createImageAttachment, createFileAttachment };

/**
 * 聊天类型
 */
export type ChatType = 'private' | 'group';

/**
 * 消息方向
 */
export type MessageDirection = 'inbound' | 'outbound';

/**
 * 统一消息
 * 
 * Agent 看到的唯一消息类型。包含所有必要信息，无需理解平台细节。
 */
export interface UnifiedMessage {
  // === 基础信息 ===
  /** 消息唯一 ID */
  id: string;
  /** 来源通道（如 'onebot', 'feishu'） */
  channel: string;
  /** 方向：入站（收到）或 出站（发送） */
  direction: MessageDirection;

  // === 会话信息 ===
  /** 聊天会话 ID */
  chatId: string;
  /** 会话类型：私聊 或 群组 */
  chatType: ChatType;
  /** 会话标题（群名称或对方昵称） */
  chatTitle?: string;

  // === 发送者信息 ===
  /** 发送者 ID */
  senderId: string;
  /** 发送者显示名称 */
  senderName?: string;
  /** 是否是自己发的消息 */
  isSelf?: boolean;

  // === 内容（Agent 关心的核心数据） ===
  /** 纯文本内容（已清理格式，可直接使用） */
  text: string;
  /** 图片附件列表（用于视觉模型） */
  images: ImageAttachment[];
  /** 文件附件列表（用于工具处理） */
  files: FileAttachment[];

  // === 上下文 ===
  /** 回复的消息 ID（如果有） */
  replyTo?: string;
  /** 被回复的消息内容（如果有） */
  replyToText?: string;

  // === 元数据 ===
  /** 时间戳 */
  timestamp: Date;
  /** 原始平台数据（调试用，通常不需要） */
  raw?: unknown;

  // === 扩展（用于插件） ===
  /** 扩展字段 */
  metadata?: Record<string, unknown>;
}

/**
 * 创建出站消息选项
 */
export interface CreateOutboundMessageOptions {
  /** 通道名称 */
  channel: string;
  /** 聊天会话 ID */
  chatId: string;
  /** 会话类型 */
  chatType?: ChatType;
  /** 消息内容 */
  text?: string;
  /** 图片附件 */
  images?: ImageAttachment[];
  /** 文件附件 */
  files?: FileAttachment[];
  /** 回复的消息 ID */
  replyTo?: string;
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 创建出站消息
 */
export function createOutboundMessage(options: CreateOutboundMessageOptions): UnifiedMessage {
  return {
    id: generateId(),
    channel: options.channel,
    direction: 'outbound',
    chatId: options.chatId,
    chatType: options.chatType || 'private',
    senderId: '', // 出站消息通常不需要 senderId
    text: options.text || '',
    images: options.images || [],
    files: options.files || [],
    replyTo: options.replyTo,
    timestamp: new Date()
  };
}

/**
 * 创建入站消息
 * 
 * 适配器使用此函数创建入站消息
 */
export function createInboundMessage(options: Omit<UnifiedMessage, 'direction'>): UnifiedMessage {
  return {
    ...options,
    direction: 'inbound'
  };
}

/**
 * 快速创建文本消息
 */
export function createTextMessage(channel: string, chatId: string, text: string): UnifiedMessage {
  return createOutboundMessage({ channel, chatId, text });
}

/**
 * 快速创建图片消息
 */
export function createImageMessage(
  channel: string, 
  chatId: string, 
  imageUrl: string, 
  text?: string
): UnifiedMessage {
  return createOutboundMessage({
    channel,
    chatId,
    text: text || '',
    images: [createImageAttachment(imageUrl)]
  });
}
