import fs from 'node:fs/promises';
import path from 'node:path';

export type LoadedMediaSource = {
  data: Uint8Array;
  base64: string;
  mimeType: string;
  fileName: string;
};

const DATA_URI_RE = /^data:([^;,]+);base64,(.+)$/s;

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

/** Shared small utilities for backend managers and runtime helpers. */

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function requireInitialized<T>(value: T | null | undefined, managerName: string): T {
  if (value === null || value === undefined) throw new Error(`${managerName} 未初始化`);
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mergeDefaults(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
  options: { overwrite?: boolean } = {},
): Record<string, unknown> {
  const merged = structuredClone(defaults) as Record<string, unknown>;
  const overwrite = options.overwrite ?? true;
  for (const key of Object.keys(overrides)) {
    const sourceVal = overrides[key];
    const targetVal = merged[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      merged[key] = mergeDefaults(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
        options,
      );
    } else if (targetVal === undefined || overwrite) {
      merged[key] = structuredClone(sourceVal as unknown);
    }
  }
  return merged;
}

export function parseModelIdentifier(modelIdentifier: string): {
  provider: string;
  modelId: string;
} {
  const idx = modelIdentifier.indexOf('/');
  if (idx === -1)
    throw new Error(`模型标识符格式无效: "${modelIdentifier}"。应为 "provider/modelId"。`);
  return { provider: modelIdentifier.slice(0, idx), modelId: modelIdentifier.slice(idx + 1) };
}
