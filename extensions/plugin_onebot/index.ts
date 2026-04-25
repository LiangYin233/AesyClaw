import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChannelContext, ChannelPlugin } from '../../src/channel/channel-types';
import { PathResolver } from '../../src/core/path-resolver';
import type {
  InboundMessage,
  MediaAttachment,
  OutboundMessage,
  SessionKey,
} from '../../src/core/types';
import type { PluginDefinition } from '../../src/plugin/plugin-types';

const DEFAULT_CONFIG = {
  enabled: false,
  serverUrl: 'ws://127.0.0.1:3001/',
  accessToken: '',
};

const WEBSOCKET_OPEN = 1;
const RECONNECT_INTERVAL_MS = 5000;
const ACTION_TIMEOUT_MS = 15000;
const DOWNLOAD_STREAM_TIMEOUT_MS = 5 * 60 * 1000;
const STREAM_CHUNK_SIZE = 64 * 1024;
const STREAM_FILE_RETENTION_MS = 5 * 60 * 1000;

const SEGMENT_TYPE_BY_ATTACHMENT: Record<MediaAttachment['type'], string> = {
  image: 'image',
  audio: 'record',
  video: 'video',
  file: 'file',
};

const DEFAULT_EXTENSION_BY_ATTACHMENT: Record<MediaAttachment['type'], string> = {
  image: '.png',
  audio: '.mp3',
  video: '.mp4',
  file: '.bin',
};

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
};

export interface OneBotChannelConfig {
  serverUrl: string;
  accessToken?: string;
}

export interface OneBotActionTransport {
  sendAction(action: string, params: Record<string, unknown>): Promise<OneBotApiResponse>;
}

interface OneBotApiResponse {
  status?: string;
  retcode?: number;
  msg?: string;
  wording?: string;
  echo?: string;
  stream?: string;
  data?: unknown;
}

interface LoadedAttachmentSource {
  data: Uint8Array;
  fileName: string;
}

interface UploadedAttachment {
  filePath: string;
  fileName: string;
}

interface OneBotMessageSegment {
  type: string;
  data: Record<string, unknown>;
}

interface PendingRequest {
  resolve(response: OneBotApiResponse): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingStreamRequest {
  responses: OneBotApiResponse[];
  resolve(responses: OneBotApiResponse[]): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface DownloadedStreamFile {
  data: Uint8Array;
  fileName: string;
}

interface OneBotInboundAttachmentSegment {
  attachmentType: MediaAttachment['type'];
  segmentType: string;
  data: Record<string, unknown>;
}

interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

interface CreateOneBotChannelOptions {
  createSocket?: (url: string) => WebSocketLike;
}

interface GlobalWithWebSocket {
  WebSocket?: new (url: string) => WebSocketLike;
}

const plugin: PluginDefinition = {
  name: 'onebot',
  version: '0.1.0',
  description: 'OneBot v11 / NapCat remote WebSocket channel plugin.',
  async init(ctx) {
    const channel = createOneBotChannel();
    ctx.registerChannel(channel);
    ctx.logger.info('OneBot channel registered');
  },
};

export function createOneBotChannel(options: CreateOneBotChannelOptions = {}): ChannelPlugin {
  const createSocket = options.createSocket ?? defaultCreateSocket;
  let context: ChannelContext | null = null;
  let config: OneBotChannelConfig | null = null;
  let socket: WebSocketLike | null = null;
  let connectingSocket: WebSocketLike | null = null;
  let connectPromise: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let nextEcho = 0;
  let destroyed = false;
  const pending = new Map<string, PendingRequest>();
  const pendingStreams = new Map<string, PendingStreamRequest>();

  const transport: OneBotActionTransport = {
    sendAction: async (action, params) => {
      await ensureConnected();
      const activeSocket = socket;
      if (!activeSocket || activeSocket.readyState !== WEBSOCKET_OPEN) {
        throw new Error('OneBot websocket is not connected');
      }

      const echo = `onebot-${Date.now()}-${++nextEcho}`;
      return new Promise<OneBotApiResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(echo);
          reject(new Error(`OneBot action "${action}" timed out after ${ACTION_TIMEOUT_MS}ms`));
        }, ACTION_TIMEOUT_MS);

        pending.set(echo, {
          resolve: (response) => {
            clearTimeout(timeout);
            resolve(response);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          timeout,
        });

        try {
          activeSocket.send(JSON.stringify({ action, params, echo }));
        } catch (err) {
          cleanupPending(echo);
          reject(new Error(`Failed to send OneBot action "${action}": ${errorMessage(err)}`));
        }
      });
    },
  };

  const sendStreamAction = async (
    action: string,
    params: Record<string, unknown>,
  ): Promise<OneBotApiResponse[]> => {
    await ensureConnected();
    const activeSocket = socket;
    if (!activeSocket || activeSocket.readyState !== WEBSOCKET_OPEN) {
      throw new Error('OneBot websocket is not connected');
    }

    const echo = `onebot-stream-${Date.now()}-${++nextEcho}`;
    return new Promise<OneBotApiResponse[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingStreams.delete(echo);
        reject(
          new Error(
            `OneBot stream action "${action}" timed out after ${DOWNLOAD_STREAM_TIMEOUT_MS}ms`,
          ),
        );
      }, DOWNLOAD_STREAM_TIMEOUT_MS);

      pendingStreams.set(echo, {
        responses: [],
        resolve: (responses) => {
          clearTimeout(timeout);
          resolve(responses);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout,
      });

      try {
        activeSocket.send(JSON.stringify({ action, params, echo }));
      } catch (err) {
        cleanupPendingStream(echo);
        reject(new Error(`Failed to send OneBot stream action "${action}": ${errorMessage(err)}`));
      }
    });
  };

  return {
    name: 'onebot',
    version: '0.1.0',
    description: 'Connects to a remote OneBot/NapCat WebSocket server and routes messages.',
    defaultConfig: DEFAULT_CONFIG,
    async init(ctx) {
      context = ctx;
      config = parseConfig(ctx.config);
      destroyed = false;
      await ensureConnected(true);
    },
    async destroy() {
      destroyed = true;
      clearReconnectTimer();
      rejectAllPending(new Error('OneBot channel stopped'));
      rejectAllPendingStreams(new Error('OneBot channel stopped'));

      const activeSocket = socket;
      const openingSocket = connectingSocket;
      socket = null;
      connectingSocket = null;
      connectPromise = null;

      try {
        openingSocket?.close();
        activeSocket?.close();
      } finally {
        context?.logger.info('OneBot websocket channel stopped');
        config = null;
        context = null;
      }
    },
    async send(sessionKey, message) {
      await sendOneBotMessage(sessionKey, message, transport);
    },
  };

  async function ensureConnected(initial = false): Promise<void> {
    if (destroyed) {
      throw new Error('OneBot channel is destroyed');
    }
    if (socket && socket.readyState === WEBSOCKET_OPEN) {
      return;
    }
    if (connectPromise) {
      return connectPromise;
    }
    if (!config || !context) {
      throw new Error('OneBot channel is not initialized');
    }

    clearReconnectTimer();
    connectPromise = connectSocket(initial).finally(() => {
      connectPromise = null;
    });
    return connectPromise;
  }

  async function connectSocket(initial: boolean): Promise<void> {
    if (!config || !context) {
      throw new Error('OneBot channel is not initialized');
    }

    const connectionUrl = buildSocketUrl(config.serverUrl, config.accessToken);
    const candidate = createSocket(connectionUrl);
    connectingSocket = candidate;
    try {
      await waitForSocketOpen(candidate);
    } finally {
      if (connectingSocket === candidate) {
        connectingSocket = null;
      }
    }

    if (destroyed) {
      candidate.close();
      return;
    }

    socket = candidate;
    attachSocketHandlers(candidate);
    context.logger.info(initial ? 'OneBot websocket connected' : 'OneBot websocket reconnected', {
      serverUrl: sanitizeServerUrl(config.serverUrl),
    });
  }

  function attachSocketHandlers(activeSocket: WebSocketLike): void {
    activeSocket.addEventListener('message', (event) => {
      if (socket !== activeSocket) {
        return;
      }
      void handleSocketMessage(event);
    });
    activeSocket.addEventListener('close', (event) => {
      if (socket !== activeSocket) {
        return;
      }
      handleSocketClose(event);
    });
    activeSocket.addEventListener('error', (event) => {
      if (socket !== activeSocket) {
        return;
      }
      context?.logger.warn('OneBot websocket error', {
        serverUrl: config ? sanitizeServerUrl(config.serverUrl) : undefined,
        error: describeSocketError(event),
      });
    });
  }

  async function handleSocketMessage(event: unknown): Promise<void> {
    const payload = parseSocketPayload(event);
    if (!payload) {
      return;
    }

    const apiResponse = parseApiResponsePayload(payload);
    if (apiResponse?.echo) {
      if (consumePendingStreamResponse(apiResponse.echo, apiResponse)) {
        return;
      }
      cleanupPending(apiResponse.echo)?.resolve(apiResponse);
      return;
    }

    const inbound = mapOneBotEventToInbound(payload, context?.name ?? 'onebot');
    if (!inbound || !context) {
      return;
    }

    const enrichedInbound = await enrichInboundMessageWithDownloads(
      inbound,
      payload,
      sendStreamAction,
    );

    try {
      await context.receiveWithSend(enrichedInbound, async (outbound) => {
        await sendOneBotMessage(enrichedInbound.sessionKey, outbound, transport);
      });
    } catch (err) {
      context?.logger.error('Failed to process OneBot inbound message', err);
    }
  }

  function handleSocketClose(_event: unknown): void {
    socket = null;
    rejectAllPending(new Error('OneBot websocket disconnected'));
    rejectAllPendingStreams(new Error('OneBot websocket disconnected'));

    if (!config || !context || destroyed) {
      return;
    }

    context.logger.warn('OneBot websocket disconnected', {
      serverUrl: sanitizeServerUrl(config.serverUrl),
      reconnectInMs: RECONNECT_INTERVAL_MS,
    });

    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    if (!config || !context || destroyed || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void ensureConnected(false).catch((err) => {
        context?.logger.error('Failed to reconnect OneBot websocket', err);
        scheduleReconnect();
      });
    }, RECONNECT_INTERVAL_MS);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function cleanupPending(echo: string): PendingRequest | null {
    const pendingRequest = pending.get(echo) ?? null;
    if (!pendingRequest) {
      return null;
    }

    clearTimeout(pendingRequest.timeout);
    pending.delete(echo);
    return pendingRequest;
  }

  function rejectAllPending(error: Error): void {
    for (const [echo, pendingRequest] of pending.entries()) {
      pending.delete(echo);
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
    }
  }

  function consumePendingStreamResponse(echo: string, response: OneBotApiResponse): boolean {
    const request = pendingStreams.get(echo);
    if (!request) {
      return false;
    }

    request.responses.push(response);
    const data = isRecord(response.data) ? response.data : null;

    if (response.status !== 'ok' || data?.type === 'error') {
      cleanupPendingStream(echo)?.reject(
        new Error(
          response.wording ??
            response.msg ??
            `OneBot stream action failed with status ${response.status ?? 'failed'}`,
        ),
      );
      return true;
    }

    if (data?.type === 'response') {
      cleanupPendingStream(echo)?.resolve(request.responses);
      return true;
    }

    return true;
  }

  function cleanupPendingStream(echo: string): PendingStreamRequest | null {
    const request = pendingStreams.get(echo) ?? null;
    if (!request) {
      return null;
    }

    clearTimeout(request.timeout);
    pendingStreams.delete(echo);
    return request;
  }

  function rejectAllPendingStreams(error: Error): void {
    for (const [echo, request] of pendingStreams.entries()) {
      pendingStreams.delete(echo);
      clearTimeout(request.timeout);
      request.reject(error);
    }
  }
}

export function mapOneBotEventToInbound(
  event: unknown,
  channelName = 'onebot',
): InboundMessage | null {
  if (!isRecord(event) || event.post_type !== 'message') {
    return null;
  }

  const messageType = event.message_type;
  if (messageType !== 'private' && messageType !== 'group') {
    return null;
  }

  const senderId = stringifyId(event.user_id);
  if (!senderId) {
    return null;
  }

  const chatId = messageType === 'group' ? stringifyId(event.group_id) : senderId;
  if (!chatId) {
    return null;
  }

  return {
    sessionKey: {
      channel: channelName,
      type: messageType,
      chatId,
    },
    content: extractOneBotText(event.message, event.raw_message),
    attachments: extractOneBotAttachments(event.message),
    sender: buildSenderInfo(senderId, event.sender),
    rawEvent: event,
  };
}

export function extractOneBotText(message: unknown, rawMessage?: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message)) {
    const text = message
      .map((segment) => extractTextSegment(segment))
      .filter((part) => part.length > 0)
      .join('');
    if (text.length > 0) {
      return text;
    }
  }

  return typeof rawMessage === 'string' ? rawMessage : '';
}

async function enrichInboundMessageWithDownloads(
  inbound: InboundMessage,
  event: Record<string, unknown>,
  sendStreamAction: (
    action: string,
    params: Record<string, unknown>,
  ) => Promise<OneBotApiResponse[]>,
): Promise<InboundMessage> {
  const segments = extractOneBotInboundAttachmentSegments(event.message);
  if (segments.length === 0) {
    return inbound;
  }

  const downloadedAttachments: MediaAttachment[] = [];
  const attachmentLines: string[] = [];
  const downloadFailures: string[] = [];

  for (const segment of segments) {
    const fallbackAttachment = mapOneBotAttachmentSegment(segment);
    try {
      const downloaded = await downloadInboundAttachment(segment, sendStreamAction);
      downloadedAttachments.push(downloaded);
      attachmentLines.push(`- ${downloaded.type}: ${downloaded.path}`);
    } catch (err) {
      if (fallbackAttachment) {
        downloadedAttachments.push(fallbackAttachment);
      }
      downloadFailures.push(`- ${segment.attachmentType}: ${errorMessage(err)}`);
    }
  }

  if (downloadedAttachments.length === 0 && downloadFailures.length === 0) {
    return inbound;
  }

  const sections: string[] = [];
  if (attachmentLines.length > 0) {
    sections.push('[Attachments]');
    sections.push(...attachmentLines);
  }
  if (downloadFailures.length > 0) {
    sections.push('[Attachment download errors]');
    sections.push(...downloadFailures);
  }

  const content =
    inbound.content.length > 0
      ? `${inbound.content}\n\n${sections.join('\n')}`
      : sections.join('\n');
  return {
    ...inbound,
    content,
    attachments: downloadedAttachments.length > 0 ? downloadedAttachments : inbound.attachments,
  };
}

async function downloadInboundAttachment(
  segment: OneBotInboundAttachmentSegment,
  sendStreamAction: (
    action: string,
    params: Record<string, unknown>,
  ) => Promise<OneBotApiResponse[]>,
): Promise<MediaAttachment> {
  const request = buildDownloadRequest(segment);
  if (!request) {
    throw new Error(
      `No OneBot download identifier available for ${segment.attachmentType} attachment`,
    );
  }

  const responses = await sendStreamAction(request.action, request.params);
  const downloaded = collectDownloadedStreamFile(responses, request.fallbackFileName);
  const localPath = await writeInboundAttachmentFile(downloaded.fileName, downloaded.data);
  const url = typeof segment.data.url === 'string' ? segment.data.url : undefined;

  return {
    type: segment.attachmentType,
    path: localPath,
    ...(url ? { url } : {}),
  };
}

function buildDownloadRequest(
  segment: OneBotInboundAttachmentSegment,
): { action: string; params: Record<string, unknown>; fallbackFileName?: string } | null {
  if (segment.segmentType === 'image') {
    const file = typeof segment.data.file === 'string' ? segment.data.file : null;
    if (!file) {
      return null;
    }
    return {
      action: 'download_file_image_stream',
      params: { file, chunk_size: STREAM_CHUNK_SIZE },
      fallbackFileName: 'image.png',
    };
  }

  if (segment.segmentType === 'record') {
    const file = typeof segment.data.file === 'string' ? segment.data.file : null;
    if (!file) {
      return null;
    }
    return {
      action: 'download_file_record_stream',
      params: { file, chunk_size: STREAM_CHUNK_SIZE, out_format: 'mp3' },
      fallbackFileName: 'audio.mp3',
    };
  }

  if (segment.segmentType === 'video') {
    const file = typeof segment.data.file === 'string' ? segment.data.file : null;
    if (!file) {
      return null;
    }
    return {
      action: 'download_file_stream',
      params: { file, chunk_size: STREAM_CHUNK_SIZE },
      fallbackFileName: 'video.mp4',
    };
  }

  if (segment.segmentType === 'file') {
    const fileId = typeof segment.data.file_id === 'string' ? segment.data.file_id : null;
    const file = typeof segment.data.file === 'string' ? segment.data.file : null;
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

function collectDownloadedStreamFile(
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
      data.data_type === 'file_info' &&
      typeof data.file_name === 'string' &&
      data.file_name.length > 0
    ) {
      fileName = data.file_name;
      continue;
    }

    if (
      data.data_type === 'file_chunk' &&
      typeof data.data === 'string' &&
      typeof data.index === 'number'
    ) {
      chunks.set(data.index, Buffer.from(data.data, 'base64'));
      continue;
    }

    if (data.type === 'response' && data.data_type === 'file_complete') {
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

async function writeInboundAttachmentFile(
  fileName: string,
  data: Uint8Array,
  root = process.cwd(),
): Promise<string> {
  const resolver = new PathResolver();
  resolver.resolve(path.resolve(root));

  const targetDir = path.join(resolver.mediaDir, 'onebot', 'inbound');
  await fs.mkdir(targetDir, { recursive: true });

  const safeFileName = sanitizeFileName(fileName);
  const targetPath = path.join(targetDir, `${Date.now()}-${randomUUID()}-${safeFileName}`);
  await fs.writeFile(targetPath, data);
  return targetPath;
}

function sanitizeFileName(fileName: string): string {
  const forbidden = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  return [...fileName]
    .map((character) => {
      const code = character.charCodeAt(0);
      return forbidden.has(character) || code < 32 ? '_' : character;
    })
    .join('');
}

export async function sendOneBotMessage(
  sessionKey: SessionKey,
  message: OutboundMessage,
  transport: OneBotActionTransport,
): Promise<void> {
  const { action, params } = await buildSendAction(sessionKey, message, transport);
  const response = await transport.sendAction(action, params);
  validateApiResponse(response);
}

async function buildSendAction(
  sessionKey: SessionKey,
  message: OutboundMessage,
  transport: OneBotActionTransport,
): Promise<{ action: string; params: Record<string, unknown> }> {
  const outboundMessage = await buildOutgoingMessagePayload(message, transport);

  if (sessionKey.type === 'private') {
    return {
      action: 'send_private_msg',
      params: { user_id: numericOrStringId(sessionKey.chatId), message: outboundMessage },
    };
  }

  if (sessionKey.type === 'group') {
    return {
      action: 'send_group_msg',
      params: { group_id: numericOrStringId(sessionKey.chatId), message: outboundMessage },
    };
  }

  throw new Error(`OneBot channel cannot send to chat type "${sessionKey.type}"`);
}

function validateApiResponse(response: OneBotApiResponse): void {
  if (response.retcode !== undefined && response.retcode !== 0) {
    throw new Error(
      `OneBot send failed with retcode ${response.retcode}: ${response.wording ?? response.msg ?? 'unknown error'}`,
    );
  }
  if (response.status && response.status !== 'ok' && response.status !== 'async') {
    throw new Error(`OneBot send failed with status ${response.status}`);
  }
}

async function buildOutgoingMessagePayload(
  message: OutboundMessage,
  transport: OneBotActionTransport,
): Promise<string | OneBotMessageSegment[]> {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return message.content;
  }

  const segments: OneBotMessageSegment[] = [];
  if (message.content.length > 0) {
    segments.push({ type: 'text', data: { text: message.content } });
  }

  for (const attachment of attachments) {
    const uploaded = await uploadAttachmentStream(attachment, transport);
    segments.push({
      type: SEGMENT_TYPE_BY_ATTACHMENT[attachment.type],
      data: {
        file: uploaded.filePath,
        file_path: uploaded.filePath,
        name: uploaded.fileName,
      },
    });
  }

  if (segments.length === 0) {
    throw new Error('OneBot outbound message has no content or attachments');
  }

  return segments;
}

async function uploadAttachmentStream(
  attachment: MediaAttachment,
  transport: OneBotActionTransport,
): Promise<UploadedAttachment> {
  const loaded = await loadAttachmentSource(attachment);
  if (loaded.data.byteLength === 0) {
    throw new Error(`Cannot upload empty ${attachment.type} attachment`);
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

function readUploadedFilePath(response: OneBotApiResponse): string {
  if (!isRecord(response.data) || typeof response.data.file_path !== 'string') {
    throw new Error('OneBot upload_file_stream did not return a file_path');
  }
  return response.data.file_path;
}

async function loadAttachmentSource(attachment: MediaAttachment): Promise<LoadedAttachmentSource> {
  if (attachment.base64) {
    return loadBase64AttachmentSource(attachment);
  }

  if (attachment.url) {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch attachment source (${response.status}): ${response.statusText}`,
      );
    }

    return {
      data: new Uint8Array(await response.arrayBuffer()),
      fileName: inferAttachmentFileName(
        attachment,
        path.basename(new URL(attachment.url).pathname) || undefined,
      ),
    };
  }

  if (attachment.path) {
    return {
      data: await fs.readFile(attachment.path),
      fileName: inferAttachmentFileName(attachment, path.basename(attachment.path)),
    };
  }

  throw new Error(`OneBot ${attachment.type} attachment requires url, path, or base64 data`);
}

function loadBase64AttachmentSource(attachment: MediaAttachment): LoadedAttachmentSource {
  const { mimeType, base64 } = parseBase64Attachment(attachment.base64 ?? '', attachment.mimeType);
  return {
    data: Buffer.from(base64, 'base64'),
    fileName: inferAttachmentFileName(attachment, undefined, mimeType),
  };
}

function parseBase64Attachment(
  source: string,
  fallbackMimeType?: string,
): { mimeType?: string; base64: string } {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(source);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: fallbackMimeType, base64: source };
}

function inferAttachmentFileName(
  attachment: MediaAttachment,
  preferredName?: string,
  mimeType?: string,
): string {
  if (preferredName && preferredName.length > 0) {
    return preferredName;
  }

  const extension =
    (mimeType ? EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()] : undefined) ??
    DEFAULT_EXTENSION_BY_ATTACHMENT[attachment.type];
  return `${attachment.type}-${Date.now()}${extension}`;
}

function extractOneBotAttachments(message: unknown): MediaAttachment[] | undefined {
  const attachments = extractOneBotInboundAttachmentSegments(message)
    .map((segment) => mapOneBotAttachmentSegment(segment))
    .filter((attachment): attachment is MediaAttachment => attachment !== null);

  return attachments.length > 0 ? attachments : undefined;
}

function extractOneBotInboundAttachmentSegments(
  message: unknown,
): OneBotInboundAttachmentSegment[] {
  if (!Array.isArray(message)) {
    return [];
  }

  return message
    .filter(
      (
        segment,
      ): segment is Record<string, unknown> & { type: string; data: Record<string, unknown> } =>
        isRecord(segment) && isRecord(segment.data) && typeof segment.type === 'string',
    )
    .map((segment) => {
      const attachmentType = mapAttachmentTypeFromSegment(segment.type);
      if (!attachmentType) {
        return null;
      }

      return {
        attachmentType,
        segmentType: segment.type,
        data: segment.data,
      };
    })
    .filter((segment): segment is OneBotInboundAttachmentSegment => segment !== null);
}

function mapOneBotAttachmentSegment(segment: unknown): MediaAttachment | null {
  if (!isRecord(segment) || !isRecord(segment.data)) {
    return null;
  }

  const segmentType =
    typeof segment.type === 'string'
      ? segment.type
      : typeof segment.segmentType === 'string'
        ? segment.segmentType
        : null;
  if (!segmentType) {
    return null;
  }

  const attachmentType = mapAttachmentTypeFromSegment(segmentType);
  if (!attachmentType) {
    return null;
  }

  const url = typeof segment.data.url === 'string' ? segment.data.url : undefined;
  const pathValue =
    typeof segment.data.path === 'string'
      ? segment.data.path
      : typeof segment.data.file_path === 'string'
        ? segment.data.file_path
        : undefined;

  if (!url && !pathValue) {
    return null;
  }

  return {
    type: attachmentType,
    ...(url ? { url } : {}),
    ...(pathValue ? { path: pathValue } : {}),
  };
}

function mapAttachmentTypeFromSegment(type: string): MediaAttachment['type'] | null {
  if (type === 'image') {
    return 'image';
  }
  if (type === 'record') {
    return 'audio';
  }
  if (type === 'video') {
    return 'video';
  }
  if (type === 'file') {
    return 'file';
  }
  return null;
}

function parseConfig(config: Record<string, unknown>): OneBotChannelConfig {
  return {
    serverUrl: readString(config.serverUrl, DEFAULT_CONFIG.serverUrl),
    accessToken: readString(config.accessToken, DEFAULT_CONFIG.accessToken),
  };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function buildSocketUrl(serverUrl: string, accessToken: string | undefined): string {
  const url = new URL(serverUrl);
  if (accessToken) {
    url.searchParams.set('access_token', accessToken);
  }
  return url.toString();
}

function sanitizeServerUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.searchParams.delete('access_token');
  return url.toString();
}

function defaultCreateSocket(url: string): WebSocketLike {
  const ctor = (globalThis as GlobalWithWebSocket).WebSocket;
  if (!ctor) {
    throw new Error('Global WebSocket client is not available in this runtime');
  }
  return new ctor(url);
}

function waitForSocketOpen(socket: WebSocketLike): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = (event: unknown) => {
      cleanup();
      reject(new Error(`OneBot websocket closed before opening: ${describeSocketClose(event)}`));
    };
    const handleError = (event: unknown) => {
      cleanup();
      reject(new Error(`Failed to connect to OneBot websocket: ${describeSocketError(event)}`));
    };
    const cleanup = () => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleError);
    };

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('close', handleClose);
    socket.addEventListener('error', handleError);
  });
}

function parseSocketPayload(event: unknown): Record<string, unknown> | null {
  const text = readSocketData(event);
  if (!text) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readSocketData(event: unknown): string | null {
  if (typeof event === 'string') {
    return event;
  }
  if (!isRecord(event)) {
    return null;
  }

  const data = event.data;
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return null;
}

function parseApiResponsePayload(payload: Record<string, unknown>): OneBotApiResponse | null {
  if (
    typeof payload.echo !== 'string' ||
    (!('status' in payload) && !('retcode' in payload) && !('data' in payload))
  ) {
    return null;
  }

  return {
    echo: payload.echo,
    ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
    ...(typeof payload.retcode === 'number' ? { retcode: payload.retcode } : {}),
    ...(typeof payload.msg === 'string' ? { msg: payload.msg } : {}),
    ...(typeof payload.wording === 'string' ? { wording: payload.wording } : {}),
    ...(typeof payload.stream === 'string' ? { stream: payload.stream } : {}),
    ...('data' in payload ? { data: payload.data } : {}),
  };
}

function extractTextSegment(segment: unknown): string {
  if (!isRecord(segment)) {
    return '';
  }
  if (segment.type !== 'text' || !isRecord(segment.data)) {
    return '';
  }
  return typeof segment.data.text === 'string' ? segment.data.text : '';
}

function buildSenderInfo(senderId: string, sender: unknown): InboundMessage['sender'] {
  if (!isRecord(sender)) {
    return { id: senderId };
  }

  const nickname = typeof sender.nickname === 'string' ? sender.nickname : undefined;
  const card = typeof sender.card === 'string' && sender.card.length > 0 ? sender.card : undefined;
  const role = typeof sender.role === 'string' ? sender.role : undefined;
  return {
    id: senderId,
    ...((card ?? nickname) ? { name: card ?? nickname } : {}),
    ...(role ? { role } : {}),
  };
}

function stringifyId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

function numericOrStringId(value: string): string | number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && String(numeric) === value ? numeric : value;
}

function describeSocketError(event: unknown): string {
  if (event instanceof Error) {
    return event.message;
  }
  if (isRecord(event)) {
    if (event.error instanceof Error) {
      return event.error.message;
    }
    if (typeof event.message === 'string') {
      return event.message;
    }
  }
  return 'unknown websocket error';
}

function describeSocketClose(event: unknown): string {
  if (!isRecord(event)) {
    return 'closed';
  }

  const code = typeof event.code === 'number' ? event.code : undefined;
  const reason =
    typeof event.reason === 'string' && event.reason.length > 0 ? event.reason : undefined;
  if (code !== undefined && reason) {
    return `code ${code}: ${reason}`;
  }
  if (code !== undefined) {
    return `code ${code}`;
  }
  if (reason) {
    return reason;
  }
  return 'closed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default plugin;
