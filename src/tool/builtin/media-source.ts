import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 已加载媒体源的数据结构。
 */
export type LoadedMediaSource = {
  data: Uint8Array;
  base64: string;
  mimeType: string;
  fileName: string;
}

type RawLoadedMediaSource = {
  data: Uint8Array;
  mimeType?: string;
  fileName: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
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
  '.mpeg': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
};

/**
 * 加载媒体源（URL 或本地文件路径）。
 *
 * @param source - 媒体来源：URL 或本地文件路径
 * @param kind - 媒体类型：'image' 或 'audio'
 * @returns 包含数据、base64、MIME 类型和文件名的 LoadedMediaSource
 * @throws 如果无法确定 MIME 类型或类型不匹配则抛出错误
 */
export async function loadMediaSource(
  source: string,
  kind: 'image' | 'audio',
): Promise<LoadedMediaSource> {
  const loaded = /^https?:\/\//i.test(source)
    ? await loadRemoteMediaSource(source)
    : await loadLocalMediaSource(source);

  const mimeType = loaded.mimeType ?? inferMimeType(loaded.fileName);
  if (!mimeType) {
    throw new Error(`无法确定 ${kind} 源的 MIME 类型: ${source}`);
  }

  if (!mimeType.startsWith(`${kind}/`)) {
    throw new Error(`期望 ${kind} 源但得到 MIME 类型 "${mimeType}"`);
  }

  return {
    data: loaded.data,
    base64: Buffer.from(loaded.data).toString('base64'),
    mimeType,
    fileName: loaded.fileName,
  };
}

async function loadRemoteMediaSource(source: string): Promise<RawLoadedMediaSource> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`获取媒体源失败 (${response.status}): ${response.statusText}`);
  }

  const url = new URL(source);
  const fileName = path.basename(url.pathname) || 'remote-media';

  return {
    data: new Uint8Array(await response.arrayBuffer()),
    mimeType: normalizeContentType(response.headers.get('content-type')),
    fileName,
  };
}

async function loadLocalMediaSource(source: string): Promise<RawLoadedMediaSource> {
  return {
    data: await fs.readFile(source),
    mimeType: inferMimeType(source),
    fileName: path.basename(source),
  };
}

function normalizeContentType(contentType: string | null): string | undefined {
  if (!contentType) {
    return undefined;
  }

  return contentType.split(';')[0]?.trim() || undefined;
}

function inferMimeType(fileName: string): string | undefined {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()];
}
