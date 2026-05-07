import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isRecord, resolvePaths } from '@aesyclaw/sdk';
import {
  DEFAULT_EXTENSION_BY_ATTACHMENT,
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

export async function downloadInboundAttachment(
  segment: OneBotInboundAttachmentSegment,
  sendStreamAction: (
    action: string,
    params: Record<string, unknown>,
  ) => Promise<OneBotApiResponse[]>,
): Promise<OneBotDownloadResult> {
  const request = buildDownloadRequest(segment);
  if (!request) {
    throw new Error(
      `No OneBot download identifier available for ${segment.attachmentType} attachment`,
    );
  }

  const responses = await sendStreamAction(request.action, request.params);
  const downloaded = collectDownloadedStreamFile(responses, request.fallbackFileName);
  const localPath = await writeInboundAttachmentFile(downloaded.fileName, downloaded.data);
  const url = typeof segment.data['url'] === 'string' ? segment.data['url'] : undefined;

  return {
    type: segment.attachmentType,
    path: localPath,
    ...(url ? { url } : {}),
  };
}

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

export async function writeInboundAttachmentFile(
  fileName: string,
  data: Uint8Array,
  root = process.cwd(),
): Promise<string> {
  const paths = resolvePaths(path.resolve(root));
  const targetDir = path.join(paths.mediaDir, 'onebot', 'inbound');
  await fs.mkdir(targetDir, { recursive: true });

  const safeFileName = sanitizeFileName(fileName);
  const targetPath = path.join(targetDir, `${Date.now()}-${randomUUID()}-${safeFileName}`);
  await fs.writeFile(targetPath, data);
  return targetPath;
}

export function sanitizeFileName(fileName: string): string {
  const forbidden = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  return [...fileName]
    .map((character) => {
      const code = character.charCodeAt(0);
      return forbidden.has(character) || code < 32 ? '_' : character;
    })
    .join('');
}

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

export function readUploadedFilePath(response: OneBotApiResponse): string {
  if (!isRecord(response.data) || typeof response.data['file_path'] !== 'string') {
    throw new Error('OneBot upload_file_stream did not return a file_path');
  }
  return response.data['file_path'];
}

export async function loadAttachmentSource(component: MediaComponent): Promise<LoadedAttachmentSource> {
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

export function loadBase64AttachmentSource(component: MediaComponent): LoadedAttachmentSource {
  const { mimeType, base64 } = parseBase64Attachment(component.base64 ?? '', component.mimeType);
  return {
    data: Buffer.from(base64, 'base64'),
    fileName: inferAttachmentFileName(component, undefined, mimeType),
  };
}

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
    DEFAULT_EXTENSION_BY_ATTACHMENT[OUTBOUND_COMPONENT_TO_ATTACHMENT_TYPE[component.type]];
  return `${component.type}-${Date.now()}${extension}`;
}
