import WebSocket from 'ws';
import { z } from 'zod';
import type {
  IChannelPlugin,
  IChannelWithSend,
  ChannelPluginContext,
  IOutboundPayload,
  ChannelPluginLogger
} from '../../src/channels/channel-plugin';
import type { IUnifiedMessage } from '../../src/agent/core/types';

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
  token?: string;
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
}

interface PluginState {
  ws: WebSocket | null;
  config: OneBotConfig | null;
  logger: ChannelPluginLogger | null;
  pipeline: any;
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

export const onebotPlugin: IChannelPlugin & IChannelWithSend = {
  name: 'channel-onebot',
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
    
    for (const [, deferred] of state.pendingRequests) {
      deferred.reject(new Error('Plugin shutdown'));
    }
    state.pendingRequests.clear();
    state.connected = false;
    
    state.logger?.info('OneBot plugin destroyed', {});
  },

  getSendFn(): (payload: IOutboundPayload) => Promise<void> {
    return createSendFn('0', 'private');
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
      logger.warn('OneBot WebSocket closed', { code, reason: reason.toString() });
      state.connected = false;
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

  const rawMessage = extractRawMessage(event.message);
  const media = extractMedia(event.message);

  const unifiedMsg: IUnifiedMessage = {
    channelId: 'onebot',
    chatId: groupIdStr,
    text: rawMessage,
    timestamp: event.time,
    metadata: {
      type: 'group',
      raw: event,
      media,
      sender: event.sender,
      messageId: String(event.message_id),
      groupId: groupIdStr,
      userId: String(event.user_id || event.sender?.user_id || '0'),
    },
  };

  const sendFn = createSendFn(groupIdStr, 'group');
  emitInbound(unifiedMsg, sendFn, state.pipeline);
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

  const rawMessage = extractRawMessage(event.message);

  const unifiedMsg: IUnifiedMessage = {
    channelId: 'onebot',
    chatId: userIdStr,
    text: rawMessage,
    timestamp: event.time,
    metadata: {
      type: 'private',
      raw: event,
      sender: event.sender,
      messageId: String(event.message_id),
      userId: userIdStr,
    },
  };

  const sendFn = createSendFn(userIdStr, 'private');
  emitInbound(unifiedMsg, sendFn, state.pipeline);
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
        const file = seg.data.file;
        const url = seg.data.url;
        return url ? `[图片: ${url}]` : `[图片: ${file}]`;
      }
      if (seg.type === 'video') {
        const file = seg.data.file;
        return `[视频: ${file}]`;
      }
      if (seg.type === 'record') {
        const file = seg.data.file;
        return `[语音: ${file}]`;
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

function extractMedia(message: string | Array<OneBotMessageSegment>): Array<{ type: string; url: string }> {
  const media: Array<{ type: string; url: string }> = [];

  if (typeof message === 'string') {
    return media;
  }

  for (const seg of message) {
    switch (seg.type) {
      case 'image':
        media.push({
          type: 'image',
          url: String(seg.data.url || seg.data.file || ''),
        });
        break;
      case 'video':
        media.push({
          type: 'video',
          url: String(seg.data.url || seg.data.file || ''),
        });
        break;
      case 'record':
        media.push({
          type: 'audio',
          url: String(seg.data.url || seg.data.file || ''),
        });
        break;
      case 'file':
        media.push({
          type: 'file',
          url: String(seg.data.url || seg.data.file || ''),
        });
        break;
    }
  }

  return media;
}

function createSendFn(targetId: string, messageType: 'group' | 'private'): (payload: IOutboundPayload) => Promise<void> {
  const ws = state.ws;
  const logger = state.logger!;

  return async (payload: IOutboundPayload): Promise<void> => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send message: WebSocket not connected', { targetId, messageType });
      return;
    }

    const message = buildMessage(payload);

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
      logger.error('Failed to send message', { error, targetId, messageType });
    }
  };
}

function buildMessage(payload: IOutboundPayload): string | Array<unknown> {
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
        message.push({ type: 'image', data: { file: media.url } });
        break;
      case 'video':
        message.push({ type: 'video', data: { file: media.url } });
        break;
      case 'audio':
        message.push({ type: 'record', data: { file: media.url } });
        break;
      default:
        message.push({ type: 'file', data: { file: media.url } });
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

function emitInbound(message: IUnifiedMessage, sendFn: (payload: IOutboundPayload) => Promise<void>, pipeline: any): void {
  const logger = state.logger!;

  logger.info('Emitting inbound message to pipeline', {
    channelId: message.channelId,
    chatId: message.chatId,
    text: message.text
  });

  if (pipeline && typeof pipeline.handleInboundWithSend === 'function') {
    pipeline.handleInboundWithSend(message, sendFn);
  } else if (pipeline && typeof pipeline.handleInbound === 'function') {
    pipeline.handleInbound(message);
  }
}

export default onebotPlugin;
