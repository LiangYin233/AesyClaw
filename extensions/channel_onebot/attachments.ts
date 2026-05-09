import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '@aesyclaw/sdk';
import {
  ATTACHMENT_KIND,
  DOWNLOAD_REQUEST_BY_SEGMENT,
  EXTENSION_BY_MIME_TYPE,
  OUTBOUND_COMPONENT_TO_ATTACHMENT_TYPE,
  STREAM_CHUNK_SIZE,
  STREAM_FILE_RETENTION_MS,
} from './constants';
import type {
  DownloadedStreamFile,
  LoadedAttachmentSource,
  MediaComponent,
  OneBotDownloadResult,
  OneBotInboundAttachmentSegment,
  UploadedAttachment,
} from './types';
import type { OneBotActionTransport, OneBotApiResponse } from './websocket-client';

/**
 * 下载 OneBot 入站附件到本地媒体目录。
 *
 * @param segment - OneBot 附件分段信息
 * @param sendStreamAction - 流式 API 请求回调
 * @param mediaDir - 媒体文件存储目录
 * @returns 下载结果（类型、路径、URL）
 */
export async function downloadInboundAttachment(
  segment: OneBotInboundAttachmentSegment,
  sendStreamAction: (
    action: string,
    params: Record<string, unknown>,
  ) => Promise<OneBotApiResponse[]>,
  mediaDir: string,
): Promise<OneBotDownloadResult> {
  const request = buildDownloadRequest(segment);
  if (!request) {
    throw new Error(
      `No OneBot download identifier available for ${segment.attachmentType} attachment`,
    );
  }

  const responses = await sendStreamAction(request.action, request.params);
  const downloaded = collectDownloadedStreamFile(responses, request.fallbackFileName);
  const localPath = await writeInboundAttachmentFile(
    downloaded.fileName,
    downloaded.data,
    mediaDir,
  );
  const url = typeof segment.data['url'] === 'string' ? segment.data['url'] : undefined;

  return {
    type: segment.attachmentType,
    path: localPath,
    ...(url ? { url } : {}),
  };
}

/**
 * 根据附件分段构建下载请求参数。
 *
 * @param segment - OneBot 附件分段信息
 * @returns 下载请求参数，无法构建时返回 null
 */
export function buildDownloadRequest(
  segment: OneBotInboundAttachmentSegment,
): { action: string; params: Record<string, unknown>; fallbackFileName?: string } | null {
  const simpleRequest = DOWNLOAD_REQUEST_BY_SEGMENT[segment.segmentType];
  if (simpleRequest) {
    const file = typeof segment.data['file'] === 'string' ? segment.data['file'] : null;
    if (!file) {
      return null;
    }
    return {
      action: simpleRequest.action,
      params: { file, chunk_size: STREAM_CHUNK_SIZE, ...simpleRequest.extraParams },
      fallbackFileName: simpleRequest.fallbackFileName,
    };
  }

  if (segment.segmentType === 'file') {
    const fileId = typeof segment.data['file_id'] === 'string' ? segment.data['file_id'] : null;
    const file = typeof segment.data['file'] === 'string' ? segment.data['file'] : null;
    if (!fileId && !file) {
      return null;
    }
    return {
      action: 'download_file_stream',
      params: {
        ...(fileId ? { file_id: fileId } : { file }),
        chunk_size: STREAM_CHUNK_SIZE,
      },
      fallbackFileName: 'file.bin',
    };
  }

  return null;
}

/**
 * 从流式下载响应中收集文件数据块并按序号拼接。
 *
 * @param responses - 流式 API 响应数组
 * @param fallbackFileName - 无法从响应获取文件名时的回退值
 * @returns 组装后的文件数据
 */
export function collectDownloadedStreamFile(
  responses: OneBotApiResponse[],
  fallbackFileName = 'attachment.bin',
): DownloadedStreamFile {
  let fileName = fallbackFileName;
  const chunks = new Map<number, Uint8Array>();
  let sawCompletion = false;

  for (const response of responses) {
    const data = isRecord(response.data) ? response.data : null;
    if (!data) {
      continue;
    }

    if (
      data['data_type'] === 'file_info' &&
      typeof data['file_name'] === 'string' &&
      data['file_name'].length > 0
    ) {
      fileName = data['file_name'];
      continue;
    }

    if (
      data['data_type'] === 'file_chunk' &&
      typeof data['data'] === 'string' &&
      typeof data['index'] === 'number'
    ) {
      chunks.set(data['index'], Buffer.from(data['data'], 'base64'));
      continue;
    }

    if (data['type'] === 'response' && data['data_type'] === 'file_complete') {
      sawCompletion = true;
    }
  }

  if (chunks.size === 0) {
    throw new Error('OneBot download stream returned no file chunks');
  }
  if (!sawCompletion) {
    throw new Error('OneBot download stream did not return a completion response');
  }

  const ordered = [...chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, chunk]) => chunk);

  return {
    data: new Uint8Array(Buffer.concat(ordered.map((chunk) => Buffer.from(chunk)))),
    fileName,
  };
}

/**
 * 将下载的附件数据写入本地文件。
 *
 * @param fileName - 文件名
 * @param data - 文件数据
 * @param mediaDir - 媒体目录
 * @returns 写入后的本地文件路径
 */
export async function writeInboundAttachmentFile(
  fileName: string,
  data: Uint8Array,
  mediaDir: string,
): Promise<string> {
  const targetDir = path.join(mediaDir, 'onebot', 'inbound');
  await fs.mkdir(targetDir, { recursive: true });

  const safeFileName = sanitizeFileName(fileName);
  const targetPath = path.join(targetDir, `${Date.now()}-${randomUUID()}-${safeFileName}`);
  await fs.writeFile(targetPath, data);
  return targetPath;
}

/**
 * 清理文件名中的不安全字符。
 *
 * @param fileName - 原始文件名
 * @returns 安全的文件名
 */
export function sanitizeFileName(fileName: string): string {
  const forbidden = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  return [...fileName]
    .map((character) => {
      const code = character.charCodeAt(0);
      return forbidden.has(character) || code < 32 ? '_' : character;
    })
    .join('');
}

/**
 * 将媒体组件作为附件上传到 OneBot 服务端（分块流式上传）。
 *
 * @param component - 媒体组件
 * @param transport - API 请求传输层
 * @returns 上传后的文件路径和文件名
 */
export async function uploadAttachmentStream(
  component: MediaComponent,
  transport: OneBotActionTransport,
): Promise<UploadedAttachment> {
  const loaded = await loadAttachmentSource(component);
  if (loaded.data.byteLength === 0) {
    throw new Error(`Cannot upload empty ${component.type} attachment`);
  }

  const streamId = randomUUID();
  const totalChunks = Math.ceil(loaded.data.byteLength / STREAM_CHUNK_SIZE);
  const sha256 = createHash('sha256').update(loaded.data).digest('hex');

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * STREAM_CHUNK_SIZE;
    const end = Math.min(start + STREAM_CHUNK_SIZE, loaded.data.byteLength);
    const chunk = loaded.data.subarray(start, end);
    const response = await transport.sendAction('upload_file_stream', {
      stream_id: streamId,
      chunk_data: Buffer.from(chunk).toString('base64'),
      chunk_index: index,
      total_chunks: totalChunks,
      file_size: loaded.data.byteLength,
      expected_sha256: sha256,
      filename: loaded.fileName,
      file_retention: STREAM_FILE_RETENTION_MS,
    });
    validateApiResponse(response);
  }

  const completion = await transport.sendAction('upload_file_stream', {
    stream_id: streamId,
    is_complete: true,
    file_retention: STREAM_FILE_RETENTION_MS,
  });
  validateApiResponse(completion);

  return {
    filePath: readUploadedFilePath(completion),
    fileName: loaded.fileName,
  };
}

/**
 * 校验 OneBot API 响应是否成功，失败时抛出异常。
 *
 * @param response - OneBot API 响应
 */
export function validateApiResponse(response: OneBotApiResponse): void {
  if (response.retcode !== undefined && response.retcode !== 0) {
    throw new Error(
      `OneBot send failed with retcode ${response.retcode}: ${response.wording ?? response.msg ?? 'unknown error'}`,
    );
  }
  if (response.status && response.status !== 'ok' && response.status !== 'async') {
    throw new Error(`OneBot send failed with status ${response.status}`);
  }
}

/**
 * 从上传完成响应中读取 OneBot 服务端返回的文件路径。
 *
 * @param response - 上传完成后的 OneBot API 响应
 * @returns 服务端文件路径
 */
export function readUploadedFilePath(response: OneBotApiResponse): string {
  if (!isRecord(response.data) || typeof response.data['file_path'] !== 'string') {
    throw new Error('OneBot upload_file_stream did not return a file_path');
  }
  return response.data['file_path'];
}

/**
 * 加载媒体附件的源数据。支持 base64、URL 和本地路径三种来源。
 *
 * @param component - 媒体组件
 * @returns 加载后的附件数据及文件名
 */
export async function loadAttachmentSource(
  component: MediaComponent,
): Promise<LoadedAttachmentSource> {
  if (component.base64) {
    return loadBase64AttachmentSource(component);
  }

  if (component.url) {
    const response = await fetch(component.url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch attachment source (${response.status}): ${response.statusText}`,
      );
    }

    return {
      data: new Uint8Array(await response.arrayBuffer()),
      fileName: inferAttachmentFileName(
        component,
        path.basename(new URL(component.url).pathname) || undefined,
      ),
    };
  }

  if (component.path) {
    return {
      data: await fs.readFile(component.path),
      fileName: inferAttachmentFileName(component, path.basename(component.path)),
    };
  }

  throw new Error(`OneBot ${component.type} attachment requires url, path, or base64 data`);
}

/**
 * 从 Base64 编码数据中加载附件源。
 *
 * @param component - 含 base64 字段的媒体组件
 * @returns 加载后的附件数据及文件名
 */
export function loadBase64AttachmentSource(component: MediaComponent): LoadedAttachmentSource {
  const { mimeType, base64 } = parseBase64Attachment(component.base64 ?? '', component.mimeType);
  return {
    data: Buffer.from(base64, 'base64'),
    fileName: inferAttachmentFileName(component, undefined, mimeType),
  };
}

/**
 * 解析 Base64 附件字符串，支持 data URI 格式。
 *
 * @param source - Base64 字符串或 data URI
 * @param fallbackMimeType - 无法从 URI 解析时的回退 MIME 类型
 * @returns 解析后的 MIME 类型和纯 Base64 数据
 */
export function parseBase64Attachment(
  source: string,
  fallbackMimeType?: string,
): { mimeType?: string; base64: string } {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(source);
  if (match) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- regex exec ensures capturing group exists
    return { mimeType: match[1], base64: match[2]! };
  }
  return { mimeType: fallbackMimeType, base64: source };
}

/**
 * 推断附件的文件名。优先使用传入的名称，否则根据组件类型和 MIME 类型生成。
 *
 * @param component - 媒体组件
 * @param preferredName - 优先使用的文件名
 * @param mimeType - MIME 类型
 * @returns 推断的文件名
 */
export function inferAttachmentFileName(
  component: MediaComponent,
  preferredName?: string,
  mimeType?: string,
): string {
  if (preferredName && preferredName.length > 0) {
    return preferredName;
  }

  const extension =
    (mimeType ? EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()] : undefined) ??
    ATTACHMENT_KIND[OUTBOUND_COMPONENT_TO_ATTACHMENT_TYPE[component.type]].defaultExtension;
  return `${component.type}-${Date.now()}${extension}`;
}
