import type { InboundFile } from '../types.js';

/**
 * Message Parser Utilities
 *
 * Provides common utilities for parsing messages across different channels.
 * Ensures consistent file type detection and message formatting.
 */

/**
 * Detect file type by extension
 *
 * @param fileName - File name with extension
 * @returns File type: 'audio', 'video', 'image', or 'file'
 */
export function detectFileType(fileName: string): 'audio' | 'video' | 'image' | 'file' {
  const ext = fileName.toLowerCase().match(/\.([^.]+)$/)?.[1];

  if (!ext) {
    return 'file';
  }

  // Audio extensions
  const audioExts = ['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'amr', 'aac', 'wma'];
  if (audioExts.includes(ext)) {
    return 'audio';
  }

  // Video extensions
  const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg'];
  if (videoExts.includes(ext)) {
    return 'video';
  }

  // Image extensions
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
  if (imageExts.includes(ext)) {
    return 'image';
  }

  return 'file';
}

/**
 * Create a standardized file object
 *
 * @param name - File name
 * @param url - File URL
 * @param type - Optional explicit type (if not provided, will be detected from name)
 * @returns InboundFile object
 */
export function createFile(
  name: string,
  url: string,
  type?: 'audio' | 'video' | 'image' | 'file'
): InboundFile {
  return {
    name,
    url,
    type: type || detectFileType(name)
  };
}

/**
 * Message segment parsing result
 */
export interface ParsedSegment {
  content: string;
  media?: string[];
  files?: InboundFile[];
}

/**
 * Common message type handlers
 *
 * These can be used by channels to handle standard message types consistently.
 */
export const MessageHandlers = {
  /**
   * Handle text message
   */
  text: (text: string): ParsedSegment => ({
    content: text || ''
  }),

  /**
   * Handle image message
   */
  image: (url: string, placeholder?: string): ParsedSegment => ({
    content: placeholder || '[图片]',
    media: [url]
  }),

  /**
   * Handle audio/voice message
   */
  audio: (url: string, name?: string): ParsedSegment => ({
    content: '[语音]',
    files: [createFile(name || 'voice.amr', url, 'audio')]
  }),

  /**
   * Handle video message
   */
  video: (url: string, name?: string): ParsedSegment => ({
    content: `[视频: ${name || 'video'}]`,
    files: [createFile(name || 'video.mp4', url, 'video')]
  }),

  /**
   * Handle file message
   */
  file: (url: string, name: string): ParsedSegment => ({
    content: `[文件: ${name}]`,
    files: [createFile(name, url)]
  }),

  /**
   * Handle at/mention message
   */
  at: (userId: string, isAll?: boolean): ParsedSegment => ({
    content: isAll ? '@全体成员' : `@${userId}`
  }),

  /**
   * Handle unknown message type
   */
  unknown: (type: string): ParsedSegment => ({
    content: `[${type}]`
  })
};
