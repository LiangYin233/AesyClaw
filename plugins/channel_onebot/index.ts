import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import WebSocket from 'ws';
import { z } from 'zod';
import type {
  ChannelPlugin,
  ChannelPluginContext,
  ChannelSendPayload,
  ChannelPluginLogger,
} from '@/sdk/channel.js';
import type { ChannelReceiveMessage } from '@/sdk/agent.js';
import type { DownloadedMedia, MediaDownloader } from '@/sdk/media.js';
import { toErrorMessage } from '@/sdk/errors.js';

let mediaDownloader: MediaDownloader | null = null;

async function getMediaDownloader(): Promise<MediaDownloader> {
  if (!mediaDownloader) {
    const module = await import('@/sdk/media.js');
    mediaDownloader = module.mediaDownloader;
  }
  return mediaDownloader;
}

export const OneBotChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  ws_url: z.string().url().optional(),
  access_token: z.string().optional(),
  group_ids: z.array(z.string()).default([]),
  private_ids: z.array(z.string()).default([]),
});

export type OneBotChannelConfig = z.infer<typeof OneBotChannelConfigSchema>;

export interface OneBotConfig {
  wsUrl: string;
  accessToken?: string;
  groupIds?: string[];
  privateIds?: string[];
}

interface OneBotMessage {
  post_type: 'message' | 'notice' | 'request' | 'meta_event';
  message_type?: 'private' | 'group';
  sub_type?: string;
  group_id?: number | string;
  user_id?: number | string;
  raw_message?: string;
  message: string | Array<OneBotMessageSegment>;
  self_id?: number | string;
  time?: number;
  font?: number;
  sender?: {
    user_id?: number | string;
    nickname?: string;
    card?: string;
    role?: string;
    title?: string;
    age?: number;
    area?: string;
    level?: string;
    sex?: string;
  };
  message_id?: number | string;
  message_seq?: number;
  auto_reply?: boolean;
  notice_type?: string;
  request_type?: string;
  meta_event_type?: string;
  detail_type?: string;
  sender_id?: number | string;
  target_id?: number | string;
  operator_id?: number | string;
  duration?: number;
  file?: {
    id?: string;
    name?: string;
    size?: number;
    busid?: number;
    url?: string;
  };
}

interface OneBotMessageSegment {
  type: string;
  data: Record<string, unknown>;
}

interface OneBotApiParams {
  action: string;
  params: Record<string, unknown>;
  echo?: string;
}

interface OneBotApiResponse {
  status: 'ok' | 'async' | 'failed';
  retcode: number;
  data?: unknown;
  msg?: string;
  wording?: string;
  echo?: string;
  stream?: string;
}

interface OneBotUploadStreamProgress {
  received_chunks?: number;
  total_chunks?: number;
}

interface OneBotUploadStreamComplete {
  status?: string;
  file_path?: string;
  file_size?: number;
  sha256?: string;
}

interface PluginState {
  ws: WebSocket | null;
  config: OneBotConfig | null;
  logger: ChannelPluginLogger | null;
  pipeline: ChannelPluginContext['pipeline'] | null;
  pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
  connected: boolean;
}

const state: PluginState = {
  ws: null,
  config: null,
  logger: null,
  pipeline: null,
  pendingRequests: new Map(),
  connected: false,
};

function rejectPendingRequests(error: Error): void {
  for (const [, deferred] of state.pendingRequests) {
    deferred.reject(error);
  }
  state.pendingRequests.clear();
}

const STREAM_UPLOAD_CHUNK_SIZE = 64 * 1024;
const STREAM_FILE_RETENTION_MS = 30 * 1000;

export const onebotPlugin: ChannelPlugin = {
  name: 'onebot',
  version: '1.0.0',
  description: 'OneBot Channel Plugin - 支持 OneBot v11/v12 协议',

  defaultOptions: {
    enabled: false,
    ws_url: 'ws://127.0.0.1:3001',
    access_token: '',
    group_ids: [],
    private_ids: [],
  },

  async init(ctx: ChannelPluginContext): Promise<void> {
    const rawConfig = ctx.config as Record<string, unknown>;
    const validatedConfig = OneBotChannelConfigSchema.parse(rawConfig);

    if (!validatedConfig.enabled) {
      ctx.logger.info('OneBot channel disabled', {});
      return;
    }

    if (!validatedConfig.ws_url) {
      throw new Error('OneBot config missing: channels.onebot.ws_url is required');
    }

    state.config = {
      wsUrl: validatedConfig.ws_url,
      accessToken: validatedConfig.access_token,
      groupIds: validatedConfig.group_ids,
      privateIds: validatedConfig.private_ids,
    };
    state.logger = ctx.logger;
    state.pipeline = ctx.pipeline;

    await connect();
  },

  async destroy(): Promise<void> {
    if (state.ws) {
      state.ws.close(1000, 'Plugin shutdown');
      state.ws = null;
    }

    rejectPendingRequests(new Error('Plugin shutdown'));
    state.connected = false;
    
    state.logger?.info('OneBot plugin destroyed', {});
  },
};

async function connect(): Promise<void> {
  const config = state.config!;
  const logger = state.logger!;

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Upgrade': 'websocket',
      'Connection': 'Upgrade',
    };

    if (config.accessToken) {
      headers['Authorization'] = `Bearer ${config.accessToken}`;
    }

    logger.info('Connecting to OneBot server...', { wsUrl: config.wsUrl });

    const ws = new WebSocket(config.wsUrl, { headers });
    state.ws = ws;

    ws.on('open', () => {
      logger.info('OneBot WebSocket connected', { wsUrl: config.wsUrl });
      state.connected = true;
      resolve();
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const payload = JSON.parse(data.toString());
        
        if (payload.echo) {
          handleApiResponse(payload as OneBotApiResponse);
        } else {
          handleEvent(payload as OneBotMessage);
        }
      } catch (error) {
        logger.error('Failed to parse OneBot message', { error });
      }
    });

    ws.on('close', (code, reason) => {
      const wasConnected = state.connected;
      const closeError = new Error(`OneBot WebSocket closed: ${code} ${reason.toString()}`);
      logger.warn('OneBot WebSocket closed', { code, reason: reason.toString() });
      state.connected = false;
      rejectPendingRequests(closeError);

      if (!wasConnected) {
        reject(closeError);
      }
    });

    ws.on('error', (error) => {
      logger.error('OneBot WebSocket error', { error });
      if (!state.connected) {
        reject(error);
      }
    });
  });
}

function handleApiResponse(response: OneBotApiResponse): void {
  const deferred = state.pendingRequests.get(response.echo!);
  if (!deferred) return;

  state.pendingRequests.delete(response.echo!);

  if (response.status === 'ok') {
    deferred.resolve(response.data);
  } else {
    deferred.reject(new Error(response.wording || response.msg || 'API call failed'));
  }
}

function handleEvent(event: OneBotMessage): void {
  const logger = state.logger!;

  if (event.post_type === 'meta_event') {
    if (event.meta_event_type === 'heartbeat' || event.meta_event_type === 'lifecycle') {
      logger.debug('Meta event received', { metaEventType: event.meta_event_type });
    }
    return;
  }

  if (event.post_type !== 'message') {
    return;
  }

  if (event.message_type === 'group') {
    handleGroupMessage(event);
  } else if (event.message_type === 'private') {
    handlePrivateMessage(event);
  }
}

function handleGroupMessage(event: OneBotMessage): void {
  const logger = state.logger!;
  const config = state.config!;

  if (!event.group_id) return;

  const groupIdStr = String(event.group_id);

  if (config.groupIds && config.groupIds.length > 0) {
    if (!config.groupIds.includes(groupIdStr)) {
      logger.debug('Message from non-whitelisted group, ignoring', { groupId: groupIdStr });
      return;
    }
  }

  processMediaInMessage(event).then(processedEvent => {
    const rawMessage = extractRawMessage(processedEvent.message);
    const media = extractMedia(processedEvent.message);

    const receivedMessage: ChannelReceiveMessage = {
      channelId: 'onebot',
      chatId: groupIdStr,
      text: rawMessage,
      timestamp: processedEvent.time,
      metadata: {
        type: 'group',
        raw: processedEvent,
        media,
        sender: processedEvent.sender,
        messageId: String(processedEvent.message_id),
        groupId: groupIdStr,
        userId: String(processedEvent.user_id || processedEvent.sender?.user_id || '0'),
      },
    };

    const send = createSend(groupIdStr, 'group');
    emitReceivedMessage(receivedMessage, send, state.pipeline);
  }).catch(err => {
    logger.error('Error processing media in group message', { error: err });
  });
}

function isLikelyRemoteUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function normalizeLocalFilePath(fileUrlOrPath: string): string {
  if (fileUrlOrPath.startsWith('file:///')) {
    return decodeURIComponent(new URL(fileUrlOrPath).pathname.replace(/^\//, ''));
  }

  return fileUrlOrPath;
}

async function resolveOutgoingMediaFile(urlOrPath: string, filename?: string): Promise<string> {
  return isLikelyRemoteUrl(urlOrPath) ? urlOrPath : uploadFileStream(urlOrPath, filename);
}

async function uploadFileStream(fileUrlOrPath: string, filename?: string): Promise<string> {
  const logger = state.logger!;
  const filePath = normalizeLocalFilePath(fileUrlOrPath);
  const fileBuffer = await fs.readFile(filePath);
  const sha256 = createHash('sha256').update(fileBuffer).digest('hex');
  const streamId = randomUUID();
  const totalChunks = Math.max(1, Math.ceil(fileBuffer.length / STREAM_UPLOAD_CHUNK_SIZE));
  const resolvedFilename = filename || path.basename(filePath) || `${streamId}.bin`;

  logger.info('Uploading OneBot file via stream API', {
    filePath,
    filename: resolvedFilename,
    fileSize: fileBuffer.length,
    totalChunks,
  });

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * STREAM_UPLOAD_CHUNK_SIZE;
    const end = Math.min(start + STREAM_UPLOAD_CHUNK_SIZE, fileBuffer.length);
    const chunkData = fileBuffer.subarray(start, end).toString('base64');
    const response = await sendApi(
      'upload_file_stream',
      {
        stream_id: streamId,
        chunk_data: chunkData,
        chunk_index: chunkIndex,
        total_chunks: totalChunks,
        file_size: fileBuffer.length,
        expected_sha256: sha256,
        filename: resolvedFilename,
        file_retention: STREAM_FILE_RETENTION_MS,
      },
      `stream-upload-${Date.now()}-${chunkIndex}-${Math.random().toString(36).slice(2)}`
    );

    const progress = (response ?? {}) as OneBotUploadStreamProgress;
    logger.debug('Uploaded OneBot file chunk', {
      filename: resolvedFilename,
      chunkIndex,
      totalChunks,
      receivedChunks: progress.received_chunks,
    });
  }

  const completed = (await sendApi(
    'upload_file_stream',
    {
      stream_id: streamId,
      is_complete: true,
    },
    `stream-complete-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )) as OneBotUploadStreamComplete;

  if (completed.status !== 'file_complete' || !completed.file_path) {
    throw new Error(`OneBot file upload returned invalid completion payload: ${JSON.stringify(completed)}`);
  }

  logger.info('OneBot file stream upload completed', {
    filename: resolvedFilename,
    filePath: completed.file_path,
    fileSize: completed.file_size,
  });

  return completed.file_path;
}

function handlePrivateMessage(event: OneBotMessage): void {
  const logger = state.logger!;
  const config = state.config!;

  if (!event.user_id) return;

  const userIdStr = String(event.user_id);

  if (config.privateIds && config.privateIds.length > 0) {
    if (!config.privateIds.includes(userIdStr)) {
      logger.debug('Message from non-whitelisted user, ignoring', { userId: userIdStr });
      return;
    }
  }

  processMediaInMessage(event).then(processedEvent => {
    const rawMessage = extractRawMessage(processedEvent.message);
    const media = extractMedia(processedEvent.message);

    const receivedMessage: ChannelReceiveMessage = {
      channelId: 'onebot',
      chatId: userIdStr,
      text: rawMessage,
      timestamp: processedEvent.time,
      metadata: {
        type: 'private',
        raw: processedEvent,
        media,
        sender: processedEvent.sender,
        messageId: String(processedEvent.message_id),
        userId: userIdStr,
      },
    };

    const send = createSend(userIdStr, 'private');
    emitReceivedMessage(receivedMessage, send, state.pipeline);
  }).catch(err => {
    logger.error('Error processing media in private message', { error: err });
  });
}

function extractRawMessage(message: string | Array<OneBotMessageSegment>): string {
  if (typeof message === 'string') {
    return message;
  }

  return message
    .map(seg => {
      if (seg.type === 'text') {
        return String(seg.data.text || '');
      }
      if (seg.type === 'image') {
        const localPath = seg.data.url as string | undefined;
        if (localPath) {
          return `[图片: ${localPath}]`;
        }
        const file = seg.data.file as string | undefined;
        return `[图片: ${file || ''}]`;
      }
      if (seg.type === 'video') {
        const localPath = seg.data.url as string | undefined;
        if (localPath) {
          return `[视频: ${localPath}]`;
        }
        const file = seg.data.file as string | undefined;
        return `[视频: ${file || ''}]`;
      }
      if (seg.type === 'record') {
        const localPath = seg.data.url as string | undefined;
        if (localPath) {
          return `[语音: ${localPath}]`;
        }
        const file = seg.data.file as string | undefined;
        return `[语音: ${file || ''}]`;
      }
      if (seg.type === 'file') {
        const localPath = seg.data.url as string | undefined;
        if (localPath) {
          return `[文件: ${localPath}]`;
        }
        const file = seg.data.file as string | undefined;
        return `[文件: ${file || ''}]`;
      }
      if (seg.type === 'at') {
        const qq = seg.data.qq;
        return qq === 'all' ? '@全体成员' : `@${qq}`;
      }
      if (seg.type === 'reply') {
        const text = seg.data.text;
        return text ? `回复: ${text}` : '';
      }
      if (seg.type === 'forward') {
        const id = seg.data.id;
        return `[转发消息: ${id}]`;
      }
      return '';
    })
    .join('');
}

function extractMedia(message: string | Array<OneBotMessageSegment>): Array<{ type: string; url: string; filename?: string }> {
  const media: Array<{ type: string; url: string; filename?: string }> = [];

  if (typeof message === 'string') {
    return media;
  }

  for (const seg of message) {
    const url = String(seg.data.url || seg.data.file || '');
    const filename = seg.data.filename as string | undefined;

    if (!url) continue;

    switch (seg.type) {
      case 'image':
        media.push({
          type: 'image',
          url,
          filename,
        });
        break;
      case 'video':
        media.push({
          type: 'video',
          url,
          filename,
        });
        break;
      case 'record':
        media.push({
          type: 'audio',
          url,
          filename,
        });
        break;
      case 'file':
        media.push({
          type: 'file',
          url,
          filename,
        });
        break;
    }
  }

  return media;
}

async function processMediaInMessage(event: OneBotMessage): Promise<OneBotMessage> {
  const logger = state.logger!;
  const mediaToDownload: Array<{ url: string; type: string; seg: OneBotMessageSegment }> = [];

  if (typeof event.message !== 'string' && Array.isArray(event.message)) {
    for (const seg of event.message) {
      if (seg.type === 'image' || seg.type === 'video' || seg.type === 'record' || seg.type === 'file') {
        const url = String(seg.data.url || seg.data.file || '');
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          mediaToDownload.push({
            url,
            type: seg.type,
            seg,
          });
        }
      }
    }
  }

  if (mediaToDownload.length === 0) {
    return event;
  }

  logger.info(
    'Downloading media files',
    { mediaCount: mediaToDownload.length, chatId: String(event.user_id || event.group_id || '') }
  );

  const downloadedMedia: Map<string, DownloadedMedia> = new Map();
  const downloader = await getMediaDownloader();

  for (const item of mediaToDownload) {
    const result = await downloader.download({
      url: item.url,
      type: item.type as 'image' | 'file' | 'video' | 'audio',
    });

    if (result.success && result.localPath) {
      downloadedMedia.set(item.url, {
        type: item.type,
        url: item.url,
        localPath: result.localPath,
        filename: result.filename!,
      });
      logger.debug('Media downloaded', { url: item.url, localPath: result.localPath });
    } else {
      logger.warn('Failed to download media', { url: item.url, error: result.error });
    }
  }

  if (downloadedMedia.size === 0) {
    return event;
  }

  if (typeof event.message === 'string') {
    return event;
  }

  const processedMessage = event.message.map(seg => {
    if (typeof seg === 'string') {
      return seg;
    }

    const url = String(seg.data.url || seg.data.file || '');
    const downloaded = downloadedMedia.get(url);

    if (downloaded) {
      return {
        ...seg,
        data: {
          ...seg.data,
          url: downloaded.localPath,
          filename: downloaded.filename,
          originalUrl: url,
        },
      };
    }

    return seg;
  });

  return {
    ...event,
    message: processedMessage,
  };
}

function createSend(targetId: string, messageType: 'group' | 'private'): (payload: ChannelSendPayload) => Promise<void> {
  return async (payload: ChannelSendPayload): Promise<void> => {
    const ws = state.ws;
    const logger = state.logger!;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send message: WebSocket not connected', { targetId, messageType });
      return;
    }

    const message = await buildMessage(payload);

    const params: OneBotApiParams = {
      action: messageType === 'group' ? 'send_group_msg' : 'send_private_msg',
      params: {
        [messageType === 'group' ? 'group_id' : 'user_id']: targetId,
        message,
      },
      echo: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };

    try {
      await sendApi(params.action, params.params, params.echo);
      logger.debug('Message sent successfully', { targetId, messageType });
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.error('Failed to send message', { error: errorMessage, targetId, messageType });
      throw error;
    }
  };
}

async function buildMessage(payload: ChannelSendPayload): Promise<string | Array<unknown>> {
  if (!payload.mediaFiles || payload.mediaFiles.length === 0) {
    return payload.text;
  }

  const message: Array<unknown> = [];

  if (payload.text) {
    message.push({ type: 'text', data: { text: payload.text } });
  }

  for (const media of payload.mediaFiles) {
    switch (media.type) {
      case 'image':
        message.push({
          type: 'image',
          data: { file: await resolveOutgoingMediaFile(media.url, media.filename) },
        });
        break;
      case 'video':
        message.push({
          type: 'video',
          data: { file: await resolveOutgoingMediaFile(media.url, media.filename) },
        });
        break;
      case 'audio':
        message.push({
          type: 'record',
          data: { file: await resolveOutgoingMediaFile(media.url, media.filename) },
        });
        break;
      default:
        message.push({
          type: 'file',
          data: {
            file: await resolveOutgoingMediaFile(media.url, media.filename),
          },
        });
    }
  }

  return message;
}

async function sendApi(action: string, params: Record<string, unknown>, echo?: string): Promise<unknown> {
  const ws = state.ws;
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket not connected');
  }

  const request: OneBotApiParams = { action, params };
  if (echo) {
    request.echo = echo;
  }

  return new Promise((resolve, reject) => {
    if (echo) {
      state.pendingRequests.set(echo, { resolve, reject });
      
      const timeout = setTimeout(() => {
        if (state.pendingRequests.has(echo)) {
          state.pendingRequests.delete(echo);
          reject(new Error(`API call timeout: ${action}`));
        }
      }, 30000);
      
      state.pendingRequests.get(echo)!.reject = (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      };
    }

    ws.send(JSON.stringify(request));

    if (!echo) {
      resolve(undefined);
    }
  });
}

function emitReceivedMessage(
  message: ChannelReceiveMessage,
  send: (payload: ChannelSendPayload) => Promise<void>,
  pipeline: ChannelPluginContext['pipeline'] | null
): void {
  const logger = state.logger!;

  logger.info('Emitting received message to pipeline', {
    channelId: message.channelId,
    chatId: message.chatId,
    text: message.text
  });

  if (!pipeline) {
    logger.warn('Cannot emit received message: pipeline not initialized', {
      channelId: message.channelId,
      chatId: message.chatId,
    });
    return;
  }

  void pipeline.receiveWithSend(message, send);
}

export default onebotPlugin;
