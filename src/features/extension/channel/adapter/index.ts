/**
 * Adapter 模块导出
 */

export { BaseChannelAdapter, createAdapter } from './BaseChannelAdapter.js';
export type { BaseAdapterOptions } from './BaseChannelAdapter.js';

export {
  attachmentFromUrl,
  attachmentFromPath,
  attachmentFromBase64,
  composeText,
  parseCommand,
  truncateText,
  sanitizeText,
  extractUrls,
  detectFileType,
  isImageFile,
  isImageUrl
} from './adapter-helpers.js';
