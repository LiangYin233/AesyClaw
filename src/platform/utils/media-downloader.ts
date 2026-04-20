/** @file 媒体下载器
 *
 * MediaDownloader 负责下载远程媒体文件到本地媒体目录，
 * 支持去重缓存（同一 URL 的并发下载只执行一次）、
 * 文件名生成（基于 URL hash 与时间戳）、MIME 类型识别。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { pathResolver } from './paths.js';
import { logger } from '../observability/logger.js';
import { toErrorMessage } from './errors.js';

/** 媒体下载选项 */
export interface MediaDownloadOptions {
  url: string;
  type: 'image' | 'file' | 'video' | 'audio';
  filename?: string;
  headers?: Record<string, string>;
}

/** 媒体下载结果 */
export interface MediaDownloadResult {
  success: boolean;
  localPath?: string;
  filename?: string;
  error?: string;
}

/** 已下载的媒体文件信息 */
export interface DownloadedMedia {
  type: string;
  url: string;
  localPath: string;
  filename: string;
}

/** 媒体下载器
 *
 * 管理远程媒体文件的下载、缓存与存储。
 */
export class MediaDownloader {
  private mediaDir: string;
  /** 正在进行的下载任务映射，用于去重并发请求 */
  private pendingDownloads: Map<string, Promise<MediaDownloadResult>>;

  constructor() {
    this.mediaDir = pathResolver.getMediaDir();
    this.pendingDownloads = new Map();
  }

  /** 生成文件名：type_timestamp_hash.ext */
  private generateFilename(url: string, type: string): string {
    const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
    const timestamp = Date.now();
    const ext = this.getExtensionFromUrl(url, type);
    return `${type}_${timestamp}_${hash}${ext}`;
  }

  /** 从 URL 提取扩展名，失败时根据类型返回默认扩展名 */
  private getExtensionFromUrl(url: string, type: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const ext = path.extname(pathname).toLowerCase();
      if (ext && ext.length <= 10) {
        return ext;
      }
    } catch {
      // Ignore URL parsing errors, will use type-based extension
    }

    const typeExtensions: Record<string, string> = {
      image: '.jpg',
      video: '.mp4',
      audio: '.mp3',
      file: '.bin',
    };

    return typeExtensions[type] || '.bin';
  }

  /** 生成下载缓存键 */
  private getDownloadCacheKey(options: MediaDownloadOptions): string {
    return `${options.type}:${options.url}`;
  }

  /** 下载媒体文件
   *
   * 若同一 URL 正在下载中，返回已有的 Promise（去重）。
   * 若文件已存在，直接返回缓存结果。
   */
  async download(options: MediaDownloadOptions): Promise<MediaDownloadResult> {
    const { url, type, filename, headers } = options;

    if (!url || url.trim() === '') {
      return { success: false, error: 'URL is empty' };
    }

    const cacheKey = this.getDownloadCacheKey(options);
    if (this.pendingDownloads.has(cacheKey)) {
      return this.pendingDownloads.get(cacheKey)!;
    }

    const downloadPromise = this.performDownload(url, type, filename, headers);
    this.pendingDownloads.set(cacheKey, downloadPromise);

    try {
      const result = await downloadPromise;
      return result;
    } finally {
      this.pendingDownloads.delete(cacheKey);
    }
  }

  /** 执行实际的下载操作 */
  private async performDownload(
    url: string,
    type: string,
    filename?: string,
    headers?: Record<string, string>
  ): Promise<MediaDownloadResult> {
    const finalFilename = path.basename(filename || this.generateFilename(url, type));
    const localPath = path.join(this.mediaDir, finalFilename);

    if (fs.existsSync(localPath)) {
      logger.debug({ localPath }, 'Media file already exists, using cached version');
      return { success: true, localPath, filename: finalFilename };
    }

    try {
      logger.info({ url, type, localPath }, 'Downloading media file');

      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          'User-Agent': 'AesyClaw/1.0',
          ...headers,
        },
      };

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const error = `HTTP ${response.status}: ${response.statusText}`;
        logger.error({ url, status: response.status }, 'Failed to download media');
        return { success: false, error };
      }

      const contentType = response.headers.get('content-type') || '';
      const actualFilename = this.extractFilenameFromResponse(response, finalFilename, contentType);
      const finalPath = path.join(this.mediaDir, actualFilename);

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      fs.writeFileSync(finalPath, buffer);

      logger.info(
        { url, localPath: finalPath, size: buffer.length, contentType },
        'Media file downloaded successfully'
      );

      return { success: true, localPath: finalPath, filename: actualFilename };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.error({ url, error: errorMessage }, 'Error downloading media');
      return { success: false, error: errorMessage };
    }
  }

  /** 从响应头提取文件名 */
  private extractFilenameFromResponse(
    response: Response,
    fallbackFilename: string,
    contentType: string
  ): string {
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=(?:(\\?['"])(.*?)\1|([^;\n]*))/i);
      const rawFilename = match?.[2] || match?.[3];
      if (rawFilename?.trim()) {
        return path.basename(rawFilename.trim());
      }
    }

    const extFromMime = this.getExtensionFromMimeType(contentType);
    if (extFromMime && !fallbackFilename.includes(extFromMime)) {
      const baseName = fallbackFilename.replace(/\.[^.]+$/, '');
      return `${baseName}${extFromMime}`;
    }

    return fallbackFilename;
  }

  /** 根据 MIME 类型获取扩展名 */
  private getExtensionFromMimeType(contentType: string): string | null {
    const mimeMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/ogg': '.ogv',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'audio/flac': '.flac',
      'application/pdf': '.pdf',
      'application/zip': '.zip',
      'application/x-rar-compressed': '.rar',
      'application/octet-stream': '',
    };

    const mime = contentType.split(';')[0].trim().toLowerCase();
    return mimeMap[mime] || null;
  }

  getMediaDir(): string {
    return this.mediaDir;
  }
}

export const mediaDownloader = new MediaDownloader();
