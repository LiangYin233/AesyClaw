/**
 * 适配器开发辅助工具
 * 
 * 常用的工具函数，简化适配器开发。
 */

import { ImageAttachment, FileAttachment, FileType, createImageAttachment, createFileAttachment } from '../protocol/attachment.js';

/**
 * 从 URL 创建附件
 * 
 * @param url - 远程 URL 或本地路径
 * @param name - 文件名
 * @returns 附件对象
 * 
 * @example
 * const image = await attachmentFromUrl('https://example.com/photo.jpg', 'photo.jpg');
 */
export async function attachmentFromUrl(url: string, name?: string): Promise<ImageAttachment | FileAttachment> {
  const filename = name || extractFilename(url) || 'file';
  
  if (isImageFile(filename)) {
    return createImageAttachment(url, filename);
  }
  
  const fileType = detectFileType(filename);
  return createFileAttachment(url, filename, fileType);
}

/**
 * 从文件路径创建附件
 * 
 * @param path - 本地文件路径
 * @param name - 文件名
 * @returns 文件附件
 * 
 * @example
 * const file = attachmentFromPath('/path/to/doc.pdf', 'document.pdf');
 */
export function attachmentFromPath(path: string, name: string): FileAttachment {
  const fileType = detectFileType(name);
  return createFileAttachment(path, name, fileType);
}

/**
 * 从 Base64 创建附件
 * 
 * @param base64 - Base64 编码的数据
 * @param filename - 文件名
 * @returns 文件附件（需要自行保存到本地后更新 url）
 */
export function attachmentFromBase64(base64: string, filename: string): FileAttachment {
  const fileType = detectFileType(filename);
  return createFileAttachment(`data:application/octet-stream;base64,${base64}`, filename, fileType);
}

/**
 * 提取文件名
 */
function extractFilename(url: string): string | undefined {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/');
    return segments[segments.length - 1] || undefined;
  } catch {
    // 不是有效 URL，可能是本地路径
    const segments = url.split(/[\\/]/);
    return segments[segments.length - 1] || undefined;
  }
}

/**
 * 检测文件类型
 */
export function detectFileType(filename: string): FileType {
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
export function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
  return imageExts.includes(ext);
}

/**
 * 检测是否为图片 URL
 */
export function isImageUrl(url: string): boolean {
  return isImageFile(url);
}

/**
 * 组合文本段（处理 @提及）
 * 
 * @param segments - 文本段数组
 * @returns 组合后的纯文本
 * 
 * @example
 * const text = composeText([
 *   { type: 'text', content: '你好 ' },
 *   { type: 'mention', userId: '123', name: '小明' },
 *   { type: 'text', content: ' ！' }
 * ]);
 * // 结果: "你好 @小明 ！"
 */
export function composeText(
  segments: Array<
    | { type: 'text'; content: string }
    | { type: 'mention'; userId: string; name?: string }
  >
): string {
  return segments
    .map(seg => {
      if (seg.type === 'text') {
        return seg.content;
      } else if (seg.type === 'mention') {
        return seg.name ? `@${seg.name}` : `@${seg.userId}`;
      }
      return '';
    })
    .join('');
}

/**
 * 解析文本中的命令
 * 
 * @param prefix - 命令前缀（如 '/'）
 * @param text - 要解析的文本
 * @returns 命令对象，如果不是命令则返回 null
 * 
 * @example
 * const cmd = parseCommand('/help', '/help arg1 arg2');
 * // 返回 { name: 'help', args: ['arg1', 'arg2'] }
 * 
 * const cmd = parseCommand('/', '/status');
 * // 返回 { name: 'status', args: [] }
 */
export function parseCommand(
  prefix: string,
  text: string
): { name: string; args: string[] } | null {
  if (!text.startsWith(prefix)) {
    return null;
  }
  
  const withoutPrefix = text.substring(prefix.length).trim();
  if (!withoutPrefix) {
    return null;
  }
  
  const parts = withoutPrefix.split(/\s+/);
  return {
    name: parts[0],
    args: parts.slice(1)
  };
}

/**
 * 截断文本
 * 
 * @param text - 要截断的文本
 * @param maxLength - 最大长度
 * @param suffix - 截断后缀（默认 '...'）
 * @returns 截断后的文本
 */
export function truncateText(text: string, maxLength: number, suffix: string = '...'): string {
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 清理文本
 * 
 * - 移除控制字符
 * - 标准化换行符（\r\n → \n）
 * - 移除多余空格
 * - 去除首尾空白
 * 
 * @param text - 要清理的文本
 * @returns 清理后的文本
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')      // Windows 换行符 → Unix
    .replace(/\r/g, '\n')        // 旧 Mac 换行符 → Unix
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')  // 移除控制字符（保留 \t \n）
    .replace(/\n{3,}/g, '\n\n')  // 3+ 个换行 → 2 个
    .replace(/[ \t]+/g, ' ')     // 多个空格/制表符 → 1 个空格
    .trim();
}

/**
 * 提取 URL
 * 
 * 从文本中提取所有 URL
 * 
 * @param text - 要解析的文本
 * @returns URL 列表
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  return text.match(urlRegex) || [];
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
