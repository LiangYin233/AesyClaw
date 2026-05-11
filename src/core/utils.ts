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

/**
 * 将任意错误对象转为字符串消息。
 *
 * @param error - 捕获的错误对象
 * @returns 错误消息字符串
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 类型守卫 — 检查值是否为非数组的普通对象。
 *
 * @param value - 待检查的值
 * @returns 是否为 Record<string, unknown>
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 深度合并默认配置，支持嵌套对象递归合并。
 *
 * @param defaults - 默认配置对象
 * @param overrides - 覆盖配置对象
 * @param options - 合并选项，overwrite 为 false 时不覆盖已有值
 * @returns 合并后的新对象
 */
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

/**
 * 解析模型标识符字符串，拆分为 provider 和 modelId。
 *
 * @param modelIdentifier - 格式为 "provider/modelId" 的标识符
 * @returns 包含 provider 和 modelId 的对象
 */
export function parseModelIdentifier(modelIdentifier: string): {
  provider: string;
  modelId: string;
} {
  const idx = modelIdentifier.indexOf('/');
  if (idx === -1)
    throw new Error(`模型标识符格式无效: "${modelIdentifier}"。应为 "provider/modelId"。`);
  return { provider: modelIdentifier.slice(0, idx), modelId: modelIdentifier.slice(idx + 1) };
}
