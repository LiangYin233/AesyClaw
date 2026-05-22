/**
 * tool/builtin/media-utils — 媒体加载工具函数。
 *
 * 从 core/utils 迁移而来，专供 builtin tools 使用。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** 已加载的媒体源 — 包含二进制数据和元数据 */
export type LoadedMediaSource = {
  data: Uint8Array;
  base64: string;
  mimeType: string;
  fileName: string;
};

const DATA_URI_RE = /^data:([^;,]+);base64,(.+)$/s;

/**
 * 解析媒体来源字符串，返回类型标识和对应数据。
 *
 * @param source - data URI、HTTP(s) URL、file:// 路径或普通文件路径
 * @returns 包含类型标签和对应字段的解析结果
 */
export function parseSource(
  source: string,
):
  | { type: 'url'; url: string }
  | { type: 'file'; filePath: string }
  | { type: 'data'; mimeType: string; base64: string } {
  if (source.startsWith('data:')) {
    const match = DATA_URI_RE.exec(source);
    if (!match) throw new Error('无效的 data URI 格式，应为 data:mime/type;base64,...');
    const [, mimeType, base64] = match;
    if (mimeType === undefined || base64 === undefined) {
      throw new Error('无效的 data URI 格式，应为 data:mime/type;base64,...');
    }
    return { type: 'data', mimeType, base64 };
  }
  if (/^https?:\/\//i.test(source)) return { type: 'url', url: source };
  if (source.startsWith('file://')) return { type: 'file', filePath: source.slice(7) };
  return { type: 'file', filePath: source };
}

/**
 * 根据来源字符串加载媒体数据（支持 data URI、远程 URL、本地文件）。
 *
 * @param source - 媒体来源字符串
 * @returns 包含二进制数据、base64、MIME 类型和文件名的 LoadedMediaSource
 */
export async function loadMediaSource(source: string): Promise<LoadedMediaSource> {
  const parsed = parseSource(source);
  switch (parsed.type) {
    case 'data': {
      const data = Uint8Array.from(Buffer.from(parsed.base64, 'base64'));
      return {
        data,
        base64: parsed.base64,
        mimeType: parsed.mimeType,
        fileName: `upload.${parsed.mimeType.split('/')[1] ?? 'bin'}`,
      };
    }
    case 'url': {
      const response = await fetch(parsed.url);
      if (!response.ok)
        throw new Error(`获取媒体源失败 (${response.status}): ${response.statusText}`);
      const url = new URL(parsed.url);
      const fileName = path.basename(url.pathname) || 'remote-media';
      const data = new Uint8Array(await response.arrayBuffer());
      return {
        data,
        base64: Buffer.from(data).toString('base64'),
        mimeType: extractMimeFromPath(fileName),
        fileName,
      };
    }
    case 'file': {
      const data = await fs.readFile(parsed.filePath);
      const fileName = path.basename(parsed.filePath);
      return {
        data,
        base64: Buffer.from(data).toString('base64'),
        mimeType: extractMimeFromPath(fileName),
        fileName,
      };
    }
  }
}

function extractMimeFromPath(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
  };
  return map[ext] ?? 'application/octet-stream';
}
