/**
 * 附件类型定义
 * 
 * 简化的资源表示，Agent 和适配器直接可用。
 */

/**
 * 附件基础接口
 */
export interface BaseAttachment {
  /** 附件唯一 ID */
  id: string;
  /** 附件名称（文件名） */
  name: string;
  /** 本地文件路径 或 远程 URL（已保证可访问） */
  url: string;
  /** MIME 类型（可选） */
  mimeType?: string;
  /** 文件大小（字节，可选） */
  size?: number;
}

/**
 * 图片附件
 */
export interface ImageAttachment extends BaseAttachment {
  type: 'image';
  /** 图片宽度（可选） */
  width?: number;
  /** 图片高度（可选） */
  height?: number;
}

/**
 * 文件类型
 */
export type FileType = 'file' | 'audio' | 'video';

/**
 * 文件附件
 */
export interface FileAttachment extends BaseAttachment {
  type: FileType;
}

/**
 * 创建图片附件
 */
export function createImageAttachment(url: string, name?: string): ImageAttachment {
  return {
    id: generateId(),
    type: 'image',
    name: name || 'image.png',
    url
  };
}

/**
 * 创建文件附件
 */
export function createFileAttachment(url: string, name: string, type: FileType = 'file'): FileAttachment {
  return {
    id: generateId(),
    type,
    name,
    url
  };
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 判断是否为图片附件
 */
export function isImageAttachment(attachment: BaseAttachment): attachment is ImageAttachment {
  return (attachment as ImageAttachment).type === 'image';
}

/**
 * 判断是否为文件附件
 */
export function isFileAttachment(attachment: BaseAttachment): attachment is FileAttachment {
  const type = (attachment as FileAttachment).type;
  return type === 'file' || type === 'audio' || type === 'video';
}
