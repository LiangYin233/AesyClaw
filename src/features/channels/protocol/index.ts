/**
 * Protocol 模块导出
 */

export type {
  UnifiedMessage,
  MessageDirection,
  ChatType,
  CreateOutboundMessageOptions
} from './unified-message.js';

export {
  createOutboundMessage,
  createInboundMessage,
  createTextMessage,
  createImageMessage
} from './unified-message.js';

export type {
  ImageAttachment,
  FileAttachment,
  BaseAttachment,
  FileType
} from './attachment.js';

export {
  createImageAttachment,
  createFileAttachment,
  isImageAttachment,
  isFileAttachment
} from './attachment.js';

export type {
  ChannelAdapter,
  AdapterContext,
  SendResult,
  AdapterConstructor
} from './adapter-interface.js';
