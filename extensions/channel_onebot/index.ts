import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChannelContext, ChannelPlugin } from '@aesyclaw/sdk';
import { resolvePaths } from '@aesyclaw/sdk';
import { getInboundMessageText, getOutboundMessageText } from '@aesyclaw/sdk';
import type {
  InboundMessage,
  MessageComponent,
  ImageComponent,
  RecordComponent,
  VideoComponent,
  FileComponent,
  OutboundMessage,
  SessionKey,
  SenderInfo,
} from '@aesyclaw/sdk';
import type { PluginDefinition } from '@aesyclaw/sdk';
import {
  createOneBotWebSocketClient,
  type OneBotActionTransport,
  type OneBotApiResponse,
  type OneBotWebSocketClient,
  type WebSocketLike,
} from './websocket-client';

const DEFAULT_CONFIG = {
  enabled: false,
  serverUrl: 'ws://127.0.0.1:3001/',
  accessToken: '',
};

const STREAM_CHUNK_SIZE = 64 * 1024;
const STREAM_FILE_RETENTION_MS = 5 * 60 * 1000;

type OneBotAttachmentType = 'image' | 'audio' | 'video' | 'file';

type OneBotDownloadResult = {
  type: OneBotAttachmentType;
  path?: string;
  url?: string;
};

type MediaComponent =
  | ImageComponent
  | RecordComponent
  | VideoComponent
  | FileComponent;

const OUTBOUND_COMPONENT_TO_ATTACHMENT_TYPE: Record<MediaComponent['type'], OneBotAttachmentType> = {
  Image: 'image',
  Record: 'audio',
  Video: 'video',
  File: 'file',
};

const SEGMENT_TYPE_BY_ATTACHMENT: Record<OneBotAttachmentType, string> = {
  image: 'image',
  audio: 'record',
  video: 'video',
  file: 'file',
};

const DEFAULT_EXTENSION_BY_ATTACHMENT: Record<OneBotAttachmentType, string> = {
  image: '.png',
  audio: '.mp3',
  video: '.mp4',
  file: '.bin',
};

const ATTACHMENT_TYPE_BY_SEGMENT: Record<string, OneBotAttachmentType | undefined> = {
  image: 'image',
  record: 'audio',
  video: 'video',
  file: 'file',
};

const SEND_ACTION_BY_CHAT_TYPE: Record<
  string,
  { action: string; idParam: 'user_id' | 'group_id' } | undefined
> = {
  private: { action: 'send_private_msg', idParam: 'user_id' },
  group: { action: 'send_group_msg', idParam: 'group_id' },
};

const DOWNLOAD_REQUEST_BY_SEGMENT: Record<
  string,
  | {
      action: string;
      fallbackFileName: string;
      extraParams?: Record<string, unknown>;
    }
  | undefined
> = {
  image: { action: 'download_file_image_stream', fallbackFileName: 'image.png' },
  record: {
    action: 'download_file_record_stream',
    fallbackFileName: 'audio.mp3',
    extraParams: { out_format: 'mp3' },
  },
  video: { action: 'download_file_stream', fallbackFileName: 'video.mp4' },
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

type OneBotChannelConfig = {
  serverUrl: string;
  accessToken?: string;
};

type OneBotLogger = ChannelContext['logger'];

type LoadedAttachmentSource = {
  data: Uint8Array;
  fileName: string;
};

type UploadedAttachment = {
  filePath: string;
  fileName: string;
};

type OneBotMessageSegment = {
  type: string;
  data: Record<string, unknown>;
};

type DownloadedStreamFile = {
  data: Uint8Array;
  fileName: string;
};

type OneBotInboundAttachmentSegment = {
  attachmentType: OneBotAttachmentType;
  componentType: Extract<MessageComponent['type'], 'Image' | 'Record' | 'Video' | 'File'>;
  segmentType: string;
  data: Record<string, unknown>;
};

type CreateOneBotChannelOptions = {
  createSocket?: (url: string) => WebSocketLike;
};

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
  let context: ChannelContext | null = null;
  let config: OneBotChannelConfig | null = null;
  let client: OneBotWebSocketClient | null = null;
  let destroyed = false;

  return {
    name: 'onebot',
    version: '0.1.0',
    description: 'Connects to a remote OneBot/NapCat WebSocket server and routes messages.',
    defaultConfig: DEFAULT_CONFIG,
    async init(ctx) {
      context = ctx;
      config = parseConfig(ctx.config);
      destroyed = false;
      client = createOneBotWebSocketClient({
        config,
        createSocket: options.createSocket,
        logger: ctx.logger,
        onPayload: handlePlatformPayload,
      });
      await client.start(true);
    },
    async destroy() {
      destroyed = true;
      client?.stop(new Error('OneBot channel stopped'));
      client = null;
      context?.logger.info('OneBot websocket channel stopped');
      config = null;
      context = null;
    },
    async send(sessionKey, message) {
      if (!client) {
        throw new Error('OneBot channel is not initialized');
      }
      await sendOneBotMessage(sessionKey, message, client, context?.logger);
    },
    receive: receiveInboundMessage,
  };

  async function receiveInboundMessage(
    message: InboundMessage,
    sessionKey: SessionKey,
    sender?: SenderInfo,
  ): Promise<void> {
    if (!context) {
      throw new Error('OneBot channel is not initialized');
    }
    await context.receive(message, sessionKey, sender);
  }

  async function handlePlatformPayload(payload: Record<string, unknown>): Promise<void> {
    const inbound = mapOneBotEventToInbound(payload, context?.name ?? 'onebot');
    if (!inbound || !context) {
      return;
    }
    const { message, sessionKey, sender } = inbound;

    const enrichedWithDownloads = await enrichInboundMessageWithDownloads(
      message,
      payload,
      async (action, params) => {
        if (!client) {
          throw new Error('OneBot channel is not initialized');
        }
        return await client.sendStreamAction(action, params);
      },
    );

    if (destroyed) {
      return;
    }

    const enrichedWithReply = await enrichInboundMessageWithReplyContent(
      enrichedWithDownloads,
      async (action, params) => {
        if (!client) {
          throw new Error('OneBot channel is not initialized');
        }
        return await client.sendAction(action, params);
      },
    );

    if (destroyed) {
      return;
    }

    try {
      await receiveInboundMessage(enrichedWithReply, sessionKey, sender);
    } catch (err) {
      context?.logger.error('Failed to process OneBot inbound message', err);
    }
  }
}

export function mapOneBotEventToInbound(
  event: unknown,
  channelName = 'onebot',
): { message: InboundMessage; sessionKey: SessionKey; sender?: SenderInfo } | null {
  if (!isRecord(event) || event['post_type'] !== 'message') {
    return null;
  }

  const messageType = event['message_type'];
  if (messageType !== 'private' && messageType !== 'group') {
    return null;
  }

  const senderId = stringifyId(event['user_id']);
  if (!senderId) {
    return null;
  }

  const chatId = messageType === 'group' ? stringifyId(event['group_id']) : senderId;
  if (!chatId) {
    return null;
  }

  return {
    message: {
      components: extractOneBotComponents(event['message']),
    },
    sessionKey: {
      channel: channelName,
      type: messageType,
      chatId,
    },
    sender: buildSenderInfo(senderId, event['sender']),
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
  const segments = extractOneBotInboundAttachmentSegments(event['message']);
  if (segments.length === 0) {
    return inbound;
  }

  const components = inbound.components.map((component) => ({ ...component }));
  const attachmentLines: string[] = [];
  const downloadFailures: string[] = [];

  for (const segment of segments) {
    const componentIndex = findDownloadComponentIndex(components, segment);
    const fallbackComponent = mapOneBotAttachmentComponent(segment);
    try {
      const downloaded = await downloadInboundAttachment(segment, sendStreamAction);
      if (componentIndex >= 0) {
        components[componentIndex] = mergeDownloadedComponent(components[componentIndex], downloaded);
      }
      attachmentLines.push(`- ${downloaded.type}: ${downloaded.path}`);
    } catch (err) {
      if (componentIndex >= 0 && fallbackComponent) {
        components[componentIndex] = { ...fallbackComponent, ...components[componentIndex] };
      }
      downloadFailures.push(`- ${segment.attachmentType}: ${errorMessage(err)}`);
    }
  }

  if (attachmentLines.length === 0 && downloadFailures.length === 0) {
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

  const content = getInboundMessageText(inbound);
  const annotationText = content.length > 0 ? `\n\n${sections.join('\n')}` : sections.join('\n');
  return {
    ...inbound,
    components: [...components, { type: 'Plain', text: annotationText }],
  };
}

async function enrichInboundMessageWithReplyContent(
  inbound: InboundMessage,
  sendAction: (action: string, params: Record<string, unknown>) => Promise<OneBotApiResponse>,
): Promise<InboundMessage> {
  const replyIndices: number[] = [];
  for (let i = 0; i < inbound.components.length; i++) {
    const component: MessageComponent = inbound.components[i];
    if (component === undefined) {
      continue;
    }
    if (component.type === 'Reply') {
      const reply = component as Extract<MessageComponent, { type: 'Reply' }>;
      if (reply.components.length === 0 && reply.id) {
        replyIndices.push(i);
      }
    }
  }

  if (replyIndices.length === 0) {
    return inbound;
  }

  const components = inbound.components.map((component) => ({ ...component }));

  for (const index of replyIndices) {
    const replyComponent = components[index] as Extract<MessageComponent, { type: 'Reply' }>;
    try {
      const msgId = replyComponent.id;
      if (!msgId) {
        continue;
      }
      const response = await sendAction('get_msg', { message_id: numericOrStringId(msgId) });
      if (response.status !== 'ok' || !isRecord(response.data)) {
        continue;
      }

      const msgData = response.data;
      const replyComponents = extractOneBotComponents(msgData['message']);
      const replySenderId = stringifyId(msgData['user_id']);
      const replySender = replySenderId
        ? buildSenderInfo(replySenderId, msgData['sender'])
        : undefined;

      components[index] = {
        ...replyComponent,
        components: replyComponents,
        ...(replySender ? { sender: replySender } : {}),
      };
    } catch {
      // Failed to fetch replied message — leave components empty as fallback
    }
  }

  return { ...inbound, components };
}

async function downloadInboundAttachment(
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
  const url = typeof segment['data']['url'] === 'string' ? segment['data']['url'] : undefined;

  return {
    type: segment.attachmentType,
    path: localPath,
    ...(url ? { url } : {}),
  };
}

function findDownloadComponentIndex(
  components: MessageComponent[],
  segment: OneBotInboundAttachmentSegment,
): number {
  return components.findIndex(
    (component) =>
      component.type === segment.componentType &&
      isMediaComponent(component) &&
      component.file === (typeof segment['data']['file'] === 'string' ? segment['data']['file'] : undefined) &&
      component.url === (typeof segment['data']['url'] === 'string' ? segment['data']['url'] : undefined),
  );
}

function mergeDownloadedComponent(
  component: MessageComponent | undefined,
  downloaded: OneBotDownloadResult,
): MessageComponent {
  const downloadedFields = {
    ...(downloaded.url ? { url: downloaded.url } : {}),
    ...(downloaded.path ? { path: downloaded.path } : {}),
  };

  switch (downloaded.type) {
    case 'image':
      {
        const fallback: Extract<MessageComponent, { type: 'Image' }> = { type: 'Image' };
        return {
          ...(component?.type === 'Image' ? component : fallback),
          ...downloadedFields,
        };
      }
    case 'audio':
      {
        const fallback: Extract<MessageComponent, { type: 'Record' }> = { type: 'Record' };
        return {
          ...(component?.type === 'Record' ? component : fallback),
          ...downloadedFields,
        };
      }
    case 'video':
      {
        const fallback: Extract<MessageComponent, { type: 'Video' }> = { type: 'Video' };
        return {
          ...(component?.type === 'Video' ? component : fallback),
          ...downloadedFields,
        };
      }
    case 'file':
      {
        const fallback: Extract<MessageComponent, { type: 'File' }> = { type: 'File' };
        return {
          ...(component?.type === 'File' ? component : fallback),
          ...downloadedFields,
        };
      }
  }
}

function componentTypeFromAttachment(
  attachmentType: OneBotAttachmentType,
): OneBotInboundAttachmentSegment['componentType'] {
  switch (attachmentType) {
    case 'image':
      return 'Image';
    case 'audio':
      return 'Record';
    case 'video':
      return 'Video';
    case 'file':
      return 'File';
  }
}

function buildDownloadRequest(
  segment: OneBotInboundAttachmentSegment,
): { action: string; params: Record<string, unknown>; fallbackFileName?: string } | null {
  const simpleRequest = DOWNLOAD_REQUEST_BY_SEGMENT[segment.segmentType];
  if (simpleRequest) {
    const file = typeof segment['data']['file'] === 'string' ? segment['data']['file'] : null;
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
    const fileId =
      typeof segment['data']['file_id'] === 'string' ? segment['data']['file_id'] : null;
    const file = typeof segment['data']['file'] === 'string' ? segment['data']['file'] : null;
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

async function writeInboundAttachmentFile(
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
  logger?: OneBotLogger,
): Promise<void> {
  const summary = summarizeOutboundMessage(sessionKey, message);
  const { action, params } = await buildSendAction(sessionKey, message, transport, logger, summary);

  try {
    const response = await transport.sendAction(action, params);
    validateApiResponse(response);
  } catch (err) {
    logger?.error(
      'OneBot outbound message send failed',
      {
        ...summary,
        stage: 'message-send',
        action,
      },
      err,
    );
    throw err;
  }
}

async function buildSendAction(
  sessionKey: SessionKey,
  message: OutboundMessage,
  transport: OneBotActionTransport,
  logger: OneBotLogger | undefined,
  summary: ReturnType<typeof summarizeOutboundMessage>,
): Promise<{ action: string; params: Record<string, unknown> }> {
  const outboundMessage = await buildOutgoingMessagePayload(message, transport, logger, summary);
  const actionConfig = SEND_ACTION_BY_CHAT_TYPE[sessionKey.type];

  if (actionConfig) {
    return {
      action: actionConfig.action,
      params: {
        [actionConfig.idParam]: numericOrStringId(sessionKey.chatId),
        message: outboundMessage,
      },
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
  logger: OneBotLogger | undefined,
  summary: ReturnType<typeof summarizeOutboundMessage>,
): Promise<string | OneBotMessageSegment[]> {
  const mediaComponents = message.components.filter(
    (c): c is MediaComponent => c.type !== 'Plain',
  );

  if (mediaComponents.length === 0) {
    return getOutboundMessageText(message);
  }

  const segments: OneBotMessageSegment[] = [];
  const text = getOutboundMessageText(message);
  if (text.length > 0) {
    segments.push({ type: 'text', data: { text } });
  }

  for (const [attachmentIndex, component] of mediaComponents.entries()) {
    let uploaded: UploadedAttachment;
    try {
      uploaded = await uploadAttachmentStream(component, transport);
    } catch (err) {
      logger?.error(
        'OneBot outbound attachment upload failed',
        {
          ...summary,
          stage: 'attachment-upload',
          attachmentIndex,
          attachmentType: component.type,
          attachmentSource: summarizeAttachmentSource(component),
        },
        err,
      );
      throw err;
    }

    segments.push({
      type: SEGMENT_TYPE_BY_ATTACHMENT[OUTBOUND_COMPONENT_TO_ATTACHMENT_TYPE[component.type]],
      data: {
        file: uploaded.filePath,
        file_path: uploaded.filePath,
        name: uploaded.fileName,
      },
    });
  }

  if (segments.length === 0) {
    throw new Error('OneBot outbound message has no components to send');
  }

  return segments;
}

async function uploadAttachmentStream(
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

function summarizeOutboundMessage(
  sessionKey: SessionKey,
  message: OutboundMessage,
): {
  sessionChannel: string;
  chatType: string;
  contentLength: number;
  attachmentCount: number;
  attachmentTypes: string[];
} {
  const text = getOutboundMessageText(message);
  const mediaComponents = message.components.filter(
    (c): c is MediaComponent => c.type !== 'Plain',
  );
  return {
    sessionChannel: sessionKey.channel,
    chatType: sessionKey.type,
    contentLength: text.length,
    attachmentCount: mediaComponents.length,
    attachmentTypes: mediaComponents.map((c) => c.type),
  };
}

function summarizeAttachmentSource(component: MediaComponent): string {
  if (component.base64) {
    return 'base64';
  }
  if (component.path) {
    return 'path';
  }
  if (component.url) {
    return 'url';
  }
  return 'missing';
}

function readUploadedFilePath(response: OneBotApiResponse): string {
  if (!isRecord(response.data) || typeof response['data']['file_path'] !== 'string') {
    throw new Error('OneBot upload_file_stream did not return a file_path');
  }
  return response['data']['file_path'];
}

async function loadAttachmentSource(component: MediaComponent): Promise<LoadedAttachmentSource> {
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

function loadBase64AttachmentSource(component: MediaComponent): LoadedAttachmentSource {
  const { mimeType, base64 } = parseBase64Attachment(component.base64 ?? '', component.mimeType);
  return {
    data: Buffer.from(base64, 'base64'),
    fileName: inferAttachmentFileName(component, undefined, mimeType),
  };
}

function parseBase64Attachment(
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

function inferAttachmentFileName(
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

function extractOneBotComponents(message: unknown): MessageComponent[] {
  if (typeof message === 'string') {
    return [{ type: 'Plain', text: message }];
  }

  if (!Array.isArray(message)) {
    return [];
  }

  return message.map((segment) => mapOneBotSegmentToComponent(segment));
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
        isRecord(segment) && isRecord(segment['data']) && typeof segment['type'] === 'string',
    )
    .map((segment) => {
      const attachmentType = mapAttachmentTypeFromSegment(segment.type);
      if (!attachmentType) {
        return null;
      }

      return {
        attachmentType,
        componentType: componentTypeFromAttachment(attachmentType),
        segmentType: segment.type,
        data: segment.data,
      };
    })
    .filter((segment): segment is OneBotInboundAttachmentSegment => segment !== null);
}

function mapOneBotAttachmentComponent(segment: unknown): MessageComponent | null {
  if (!isRecord(segment) || !isRecord(segment['data'])) {
    return null;
  }

  const segmentType =
    typeof segment['type'] === 'string'
      ? segment['type']
      : typeof segment['segmentType'] === 'string'
        ? segment['segmentType']
        : null;
  if (!segmentType) {
    return null;
  }

  const attachmentType = mapAttachmentTypeFromSegment(segmentType);
  if (!attachmentType) {
    return null;
  }

  return mapMediaSegmentToComponent(componentTypeFromAttachment(attachmentType), segment['data']);
}

function mapOneBotSegmentToComponent(segment: unknown): MessageComponent {
  if (!isRecord(segment) || typeof segment['type'] !== 'string') {
    return { type: 'Unknown' };
  }

  const data = isRecord(segment['data']) ? segment['data'] : {};
  switch (segment['type']) {
    case 'text':
      return { type: 'Plain', text: typeof data['text'] === 'string' ? data['text'] : '' };
    case 'image':
      return mapMediaSegmentToComponent('Image', data);
    case 'record':
      return mapMediaSegmentToComponent('Record', data);
    case 'video':
      return mapMediaSegmentToComponent('Video', data);
    case 'file':
      return mapFileSegmentToComponent(data);
    case 'face':
    case 'at':
    case 'forward':
    case 'node':
    case 'nodes':
      return { type: 'Unknown', segmentType: segment['type'], data };
    case 'reply':
      return { type: 'Reply', components: [], ...optionalStringField('id', stringifyId(data['id'])) };
    default:
      return { type: 'Unknown', segmentType: segment['type'], data };
  }
}

function mapMediaSegmentToComponent(
  type: Extract<MessageComponent['type'], 'Image' | 'Record' | 'Video' | 'File'>,
  data: Record<string, unknown>,
): MessageComponent {
  const url = typeof data['url'] === 'string' ? data['url'] : undefined;
  const pathValue = typeof data['path'] === 'string' ? data['path'] : undefined;
  const file = typeof data['file'] === 'string' ? data['file'] : undefined;
  const fields = {
    ...(url ? { url } : {}),
    ...(pathValue ? { path: pathValue } : {}),
    ...(file ? { file } : {}),
  };

  switch (type) {
    case 'Image':
      return { type: 'Image', ...fields };
    case 'Record':
      return { type: 'Record', ...fields };
    case 'Video':
      return { type: 'Video', ...fields };
    case 'File':
      return { type: 'File', ...fields };
  }
}

function mapFileSegmentToComponent(data: Record<string, unknown>): MessageComponent {
  const url = typeof data['url'] === 'string' ? data['url'] : undefined;
  const pathValue = typeof data['path'] === 'string' ? data['path'] : undefined;
  const file = typeof data['file'] === 'string' ? data['file'] : undefined;
  const fileId = typeof data['file_id'] === 'string' ? data['file_id'] : undefined;
  const name = typeof data['name'] === 'string' ? data['name'] : undefined;
  return {
    type: 'File',
    ...(url ? { url } : {}),
    ...(pathValue ? { path: pathValue } : {}),
    ...(file ? { file } : {}),
    ...(fileId ? { fileId } : {}),
    ...(name ? { name } : {}),
  };
}

function isMediaComponent(
  component: MessageComponent,
): component is Extract<MessageComponent, { type: 'Image' | 'Record' | 'Video' | 'File' }> {
  return ['Image', 'Record', 'Video', 'File'].includes(component.type);
}

function optionalStringField(key: string, value: string | null): Record<string, string> {
  return value ? { [key]: value } : {};
}

function mapAttachmentTypeFromSegment(type: string): OneBotAttachmentType | null {
  return ATTACHMENT_TYPE_BY_SEGMENT[type] ?? null;
}

function parseConfig(config: Record<string, unknown>): OneBotChannelConfig {
  return {
    serverUrl: readString(config['serverUrl'], DEFAULT_CONFIG.serverUrl),
    accessToken: readString(config['accessToken'], DEFAULT_CONFIG.accessToken),
  };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function extractTextSegment(segment: unknown): string {
  if (!isRecord(segment)) {
    return '';
  }
  if (segment['type'] !== 'text' || !isRecord(segment['data'])) {
    return '';
  }
  return typeof segment['data']['text'] === 'string' ? segment['data']['text'] : '';
}

function buildSenderInfo(senderId: string, sender: unknown): SenderInfo {
  if (!isRecord(sender)) {
    return { id: senderId };
  }

  const nickname = typeof sender['nickname'] === 'string' ? sender['nickname'] : undefined;
  const card =
    typeof sender['card'] === 'string' && sender['card'].length > 0 ? sender['card'] : undefined;
  const role = typeof sender['role'] === 'string' ? sender['role'] : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default plugin;
