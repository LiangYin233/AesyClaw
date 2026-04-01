/**
 * OneBot 渠道适配器
 * 
 * 基于 NapCat OneBot 11 协议，支持 WebSocket 连接。
 * 
 * 配置选项（config.toml）：
 * - wsUrl: WebSocket 连接地址（例：ws://127.0.0.1:3001）
 * - token: 认证令牌（可选）
 * - friendAllowFrom: 允许接收私聊的用户 ID 列表（空数组表示允许所有）
 * - groupAllowFrom: 允许接收消息的群 ID 列表（空数组表示允许所有）
 * - enabled: 是否启用（默认 true）
 */

import { WebSocket } from 'ws';
import { BaseChannelAdapter, BaseAdapterOptions } from '../../src/features/extension/channel/adapter/BaseChannelAdapter.js';
import { UnifiedMessage, createInboundMessage } from '../../src/features/extension/channel/protocol/unified-message.js';
import { SendResult } from '../../src/features/extension/channel/protocol/adapter-interface.js';
import { ImageAttachment, FileAttachment } from '../../src/features/extension/channel/protocol/attachment.js';
import { logger } from '../../src/platform/observability/index.js';

interface OneBotConfig {
  wsUrl: string;
  token?: string;
  friendAllowFrom?: string[];
  groupAllowFrom?: string[];
}

interface OneBotMessageSegment {
  type: string;
  data: Record<string, unknown>;
}

interface OneBotEvent {
  post_type: string;
  message_type?: 'private' | 'group' | 'discuss';
  message_id: number;
  user_id: number;
  group_id?: number;
  discuss_id?: number;
  message: string | OneBotMessageSegment[];
  raw_message?: string;
  font: number;
  sender: {
    user_id: number;
    nickname?: string;
    card?: string;
    role?: string;
    age?: number;
    area?: string;
    level?: string;
    sex?: string;
    title?: string;
  };
  sub_type?: string;
  time: number;
}

interface OneBotApiResponse {
  status: 'ok' | 'failed';
  retcode: number;
  data: unknown;
  echo?: string;
}

interface OneBotOutgoingPayload {
  action: string;
  params: Record<string, unknown>;
  echo?: string;
}

class OneBotChannelAdapter extends BaseChannelAdapter {
  readonly name = 'onebot';
  
  private ws?: WebSocket;
  private config?: OneBotConfig;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000;
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private messageIdCounter = 0;
  private log = logger.child('OneBot');

  constructor(options?: Partial<BaseAdapterOptions>) {
    super(options);
  }

  protected async onStart(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.log.warn('Adapter already started, skipping');
      return;
    }
    
    const ctx = (this as unknown as { context?: { config?: OneBotConfig } }).context;
    this.config = ctx?.config || { wsUrl: '' };
    
    if (!this.config.wsUrl) {
      throw new Error('OneBot WebSocket URL not configured');
    }
    
    await this.connect();
  }

  protected async onStop(): Promise<void> {
    this.clearReconnectTimer();
    this.pendingRequests.forEach(({ reject }) => reject(new Error('Connection closed')));
    this.pendingRequests.clear();
    
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Adapter stopped');
      }
      this.ws = undefined;
    }
  }

  protected async parsePlatformEvent(rawEvent: unknown): Promise<UnifiedMessage | null> {
    const event = rawEvent as OneBotEvent;
    
    if (event.post_type !== 'message') {
      return null;
    }

    const messageType = event.message_type;
    if (!messageType || (messageType !== 'private' && messageType !== 'group')) {
      return null;
    }

    const isPrivate = messageType === 'private';
    const sourceId = isPrivate ? event.user_id.toString() : event.group_id?.toString();
    
    if (!sourceId) {
      return null;
    }

    if (!this.isSourceAllowed(isPrivate, sourceId)) {
      return null;
    }

    const sender = event.sender || { user_id: event.user_id };
    const senderName = sender.nickname || sender.card || `User_${event.user_id}`;
    const chatTitle = isPrivate ? senderName : `Group_${event.group_id}`;

    const messageContent = Array.isArray(event.message) 
      ? this.parseMessageChain(event.message)
      : event.message;

    const images = this.extractImagesFromEvent(event.message);
    const files = this.extractFilesFromEvent(event.message);
    const mentions = this.extractMentionIds(event.message);

    return createInboundMessage({
      id: this.generateMessageId(event.message_id),
      channel: 'onebot',
      chatId: sourceId,
      chatType: isPrivate ? 'private' : 'group',
      chatTitle,
      senderId: event.user_id.toString(),
      senderName,
      text: messageContent,
      images,
      files,
      timestamp: new Date(event.time * 1000),
      raw: event,
      metadata: {
        mentions,
        subType: event.sub_type,
        messageId: event.message_id,
        groupId: event.group_id,
        userId: event.user_id
      }
    });
  }

  protected async sendToPlatform(message: UnifiedMessage): Promise<SendResult> {
    try {
      const isGroup = message.chatType === 'group';
      
      const obMessage = await this.buildOneBotMessage(message);
      
      const payload: Record<string, unknown> = {
        message: obMessage
      };

      if (isGroup) {
        payload.group_id = message.chatId;
      } else {
        payload.user_id = message.chatId;
      }

      const response = await this.callApi(
        isGroup ? 'send_group_msg' : 'send_private_msg',
        payload
      ) as { message_id: number };

      if (response && typeof response === 'object' && 'message_id' in response) {
        return {
          success: true,
          messageId: response.message_id.toString()
        };
      }

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  private async connect(): Promise<void> {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = undefined;
    }
    
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.config?.token) {
        headers['Authorization'] = `Bearer ${this.config.token}`;
      }

      this.ws = new WebSocket(this.config!.wsUrl, { headers });

      this.ws.on('open', () => {
        this.log.info('WebSocket connected');
        this.reconnectAttempts = 0;
        resolve();
      });

      this.ws.on('message', async (data) => {
        try {
          const payload = JSON.parse(data.toString());
          await this.handlePayload(payload);
        } catch (error) {
          this.log.error('Failed to parse message', { error: error instanceof Error ? error.message : String(error) });
        }
      });

      this.ws.on('close', (code, reason) => {
        const isNormalClose = code === 1000;
        if (isNormalClose) {
          this.log.debug('WebSocket closed', { code });
        } else {
          this.log.warn('WebSocket disconnected', { code, reason: reason.toString() });
        }
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.log.error('WebSocket error', { error: error.message });
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(error);
        }
      });
    });
  }

  private async handlePayload(payload: OneBotEvent | OneBotApiResponse): Promise<void> {
    if ('echo' in payload && payload.echo) {
      const pending = this.pendingRequests.get(payload.echo);
      if (pending) {
        this.pendingRequests.delete(payload.echo);
        if (payload.status === 'ok') {
          pending.resolve(payload.data);
        } else {
          pending.reject(new Error(`API error: ${payload.retcode}`));
        }
      }
      return;
    }

    if ('post_type' in payload) {
      const self = this as unknown as { context?: { reportIncoming: (msg: UnifiedMessage) => Promise<void> }; parseEvent: (evt: unknown) => Promise<UnifiedMessage | null> };
      if (self.context) {
        const message = await self.parseEvent(payload);
        if (message) {
          await self.context.reportIncoming(message);
        }
      }
    }
  }

  private async callApi(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const echo = `req_${++this.messageIdCounter}_${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(new Error(`API call timeout: ${action}`));
      }, 30000);

      this.pendingRequests.set(echo, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      const outgoing: OneBotOutgoingPayload = { action, params, echo };
      this.ws!.send(JSON.stringify(outgoing));
    });
  }

  private async buildOneBotMessage(message: UnifiedMessage): Promise<(string | OneBotMessageSegment)[]> {
    const segments: (string | OneBotMessageSegment)[] = [];

    if (message.text) {
      segments.push({ type: 'text', data: { text: message.text } });
    }

    for (const image of message.images || []) {
      segments.push({ type: 'image', data: { file: image.url } });
    }

    for (const file of message.files || []) {
      if (file.type === 'audio') {
        segments.push({ type: 'record', data: { file: file.url } });
      } else if (file.type === 'video') {
        segments.push({ type: 'video', data: { file: file.url } });
      } else {
        segments.push({ type: 'file', data: { file: file.url, name: file.name } });
      }
    }

    return segments;
  }

  private parseMessageChain(segments: OneBotMessageSegment[]): string {
    return segments
      .filter(seg => seg.type === 'text' || seg.type === 'plain')
      .map(seg => {
        const data = seg.data as Record<string, string>;
        return data.text || data.content || '';
      })
      .join('');
  }

  private extractImagesFromEvent(message: string | OneBotMessageSegment[]): ImageAttachment[] {
    const images: ImageAttachment[] = [];
    
    if (!Array.isArray(message)) return images;

    for (const seg of message) {
      if (seg.type === 'image') {
        const data = seg.data as Record<string, unknown>;
        const file = typeof data.file === 'string' ? data.file : String(data.file || '');
        images.push({
          id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type: 'image',
          name: file.split('/').pop() || 'image.png',
          url: file
        });
      }
    }
    
    return images;
  }

  private extractFilesFromEvent(message: string | OneBotMessageSegment[]): FileAttachment[] {
    const files: FileAttachment[] = [];
    
    if (!Array.isArray(message)) return files;

    for (const seg of message) {
      if (seg.type === 'record' || seg.type === 'video' || seg.type === 'file') {
        const data = seg.data as Record<string, unknown>;
        const file = typeof data.file === 'string' ? data.file : String(data.file || '');
        const name = typeof data.name === 'string' ? data.name : file.split('/').pop() || 'file';
        
        let type: 'file' | 'audio' | 'video' = 'file';
        if (seg.type === 'record') type = 'audio';
        else if (seg.type === 'video') type = 'video';
        
        files.push({
          id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type,
          name,
          url: file
        });
      }
    }
    
    return files;
  }

  private extractMentionIds(message: string | OneBotMessageSegment[]): string[] {
    const mentions: string[] = [];
    
    if (!Array.isArray(message)) return mentions;
    
    for (const seg of message) {
      if (seg.type === 'at') {
        const data = seg.data as Record<string, unknown>;
        if (data.qq && typeof data.qq === 'string') {
          mentions.push(data.qq);
        } else if (data.user_id) {
          mentions.push(String(data.user_id));
        }
      }
    }
    
    return mentions;
  }

  private isSourceAllowed(isPrivate: boolean, sourceId: string): boolean {
    if (!this.config) return true;
    
    if (isPrivate) {
      const allowList = this.config.friendAllowFrom;
      if (!allowList || allowList.length === 0) return true;
      return allowList.includes(sourceId);
    } else {
      const allowList = this.config.groupAllowFrom;
      if (!allowList || allowList.length === 0) return true;
      return allowList.includes(sourceId);
    }
  }

  private generateMessageId(platformId: number): string {
    return `onebot_${platformId}_${Date.now()}`;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log.error('Max reconnect attempts reached, giving up');
      return;
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
      } catch (error) {
        this.log.warn('Reconnect failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

const adapter = new OneBotChannelAdapter();

export default adapter;
