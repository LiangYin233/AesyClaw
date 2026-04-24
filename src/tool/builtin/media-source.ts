import fs from 'node:fs/promises';
import path from 'node:path';

export interface LoadedMediaSource {
  data: Uint8Array;
  base64: string;
  mimeType: string;
  fileName: string;
}

interface RawLoadedMediaSource {
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

export async function loadMediaSource(source: string, kind: 'image' | 'audio'): Promise<LoadedMediaSource> {
  const loaded = /^https?:\/\//i.test(source)
    ? await loadRemoteMediaSource(source)
    : await loadLocalMediaSource(source);

  const mimeType = loaded.mimeType ?? inferMimeType(loaded.fileName);
  if (!mimeType) {
    throw new Error(`Could not determine MIME type for ${kind} source: ${source}`);
  }

  if (!mimeType.startsWith(`${kind}/`)) {
    throw new Error(`Expected an ${kind} source but got MIME type "${mimeType}"`);
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
    throw new Error(`Failed to fetch media source (${response.status}): ${response.statusText}`);
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
