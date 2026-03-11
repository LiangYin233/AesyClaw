import WebSocket from 'ws';
import fs from 'fs';
import type { EventBus } from '../../src/bus/EventBus.ts';
import { BaseChannel } from '../../src/channels/BaseChannel.ts';
import { MessageHandlers } from '../../src/channels/MessageParser.ts';
import { CONSTANTS } from '../../src/constants/index.ts';
import { logger } from '../../src/logger/index.ts';
import { metrics } from '../../src/logger/Metrics.ts';
import type { InboundFile, OutboundMessage } from '../../src/types.ts';
import type { ChannelPluginDefinition } from '../../src/channels/ChannelManager.ts';

interface OneBotConfig {
  wsUrl: string;
  token?: string;
  friendAllowFrom?: string[];
  groupAllowFrom?: string[];
  maxReconnectAttempts?: number;
  reconnectBaseDelay?: number;
  reconnectMaxDelay?: number;
  heartbeatInterval?: number;
}

class OneBotChannel extends BaseChannel {
  readonly name = 'onebot';
  private ws?: WebSocket;
  private selfId?: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectBaseDelay: number;
  private reconnectMaxDelay: number;
  private heartbeatInterval?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private isReconnecting = false;
  private pendingActions: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = [];
  protected log = logger.child({ prefix: 'OneBot' });

  constructor(config: OneBotConfig, eventBus: EventBus, workspace?: string) {
    super(config, eventBus, workspace);
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 0;
    this.reconnectBaseDelay = config.reconnectBaseDelay ?? 1000;
    this.reconnectMaxDelay = config.reconnectMaxDelay ?? 30000;
  }

  async start(): Promise<void> {
    this.log.info(`Starting channel, wsUrl: ${this.config.wsUrl}`);
    await this.connectWebSocket();
    this.running = true;
    this.startHeartbeat();
    this.log.info('Channel started');
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.config.token) {
        headers.Authorization = `Bearer ${this.config.token}`;
      }

      this.log.info(`Connecting to ${this.config.wsUrl}...`);
      this.ws = new WebSocket(this.config.wsUrl, { headers });

      this.ws.on('open', async () => {
        this.log.info('WebSocket connected');
        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        try {
          const res = await this.sendAction('get_login_info', {});
          this.selfId = res.data?.user_id?.toString();
          this.log.info(`Logged in as: ${this.selfId}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log.warn(`Failed to get login info: ${message}`);
        } finally {
          this.flushPendingActions();
          resolve();
        }
      });

      this.ws.on('message', (data) => {
        try {
          const payload = JSON.parse(data.toString());
          this.handleOneBotEvent(payload);
        } catch (error) {
          this.log.error('Failed to parse message:', error);
        }
      });

      this.ws.on('close', () => {
        this.log.debug('WebSocket disconnected');
        this.clearHeartbeat();
        this.handleDisconnect();
      });

      this.ws.on('error', (error) => {
        this.log.error(`WebSocket error: ${error.message}`);
        if (this.reconnectAttempts === 0 && !this.isReconnecting) {
          reject(error);
        }
      });
    });
  }

  private handleDisconnect(): void {
    if (!this.running) return;

    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.flushPendingActions(true);

    const delay = Math.min(
      this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectMaxDelay
    );

    if (this.maxReconnectAttempts > 0 && this.reconnectAttempts > this.maxReconnectAttempts) {
      this.log.error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`);
      this.running = false;
      return;
    }

    const attemptMsg = this.maxReconnectAttempts > 0
      ? ` (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      : this.reconnectAttempts > 1 ? ` (attempt ${this.reconnectAttempts})` : '';
    this.log.info(`Reconnecting in ${delay}ms${attemptMsg}`);

    setTimeout(() => {
      this.connectWebSocket().then(() => {
        this.log.info('Reconnected successfully');
      }).catch((err: Error) => {
        this.log.error(`Reconnect failed: ${err.message}`);
      });
    }, delay);
  }

  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval ?? 30000;

    this.heartbeatTimer = setTimeout(() => {
      this.sendHeartbeat();
      this.heartbeatInterval = setInterval(() => {
        this.sendHeartbeat();
      }, interval);
    }, interval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      await this.sendAction('get_status', {});
    } catch {
    }
  }

  private flushPendingActions(reject = false): void {
    const pending = [...this.pendingActions];
    this.pendingActions = [];
    for (const { resolve, reject: rejectPending } of pending) {
      if (reject) {
        rejectPending(new Error('WebSocket reconnected'));
      } else {
        resolve(undefined);
      }
    }
  }

  private async sendAction(action: string, params: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        if (this.running && this.isReconnecting) {
          this.pendingActions.push({ resolve, reject });
          return;
        }
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = Date.now();
      const message = JSON.stringify({ action, params, echo: id });
      let settled = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (!settled) {
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          this.ws?.off('message', handler);
        }
      };

      const settle = (fn: (value: any) => void, value: any) => {
        cleanup();
        fn(value);
      };

      const handler = (data: WebSocket.RawData) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.echo === id) {
            if (response.status === 'ok') {
              settle(resolve, response);
            } else {
              settle(reject, new Error(response.msg || 'Action failed'));
            }
          }
        } catch (error) {
          this.log.debug('Failed to parse response:', error);
        }
      };

      this.ws.on('message', handler);

      try {
        this.ws.send(message);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

      timeoutHandle = setTimeout(() => {
        settle(reject, new Error('Action timeout'));
      }, CONSTANTS.WEBSOCKET_ACTION_TIMEOUT);
    });
  }

  private handleOneBotEvent(payload: any): void {
    const postType = payload.post_type;

    if (postType === 'message') {
      void this.handleMessageEvent(payload);
    } else if (postType === 'notice') {
      this.log.debug(`Notice: ${payload.notice_type}`);
    } else if (postType === 'request') {
      this.log.debug(`Request: ${payload.request_type}`);
    }
  }

  private async handleMessageEvent(payload: any): Promise<void> {
    const messageType = payload.message_type;
    const userId = payload.user_id;
    const groupId = payload.group_id;

    const senderId = userId?.toString();
    const chatId = messageType === 'private' ? userId?.toString() : groupId?.toString();

    if (!senderId || !chatId) return;

    const messageId = payload.message_id?.toString();
    await this.processInboundMessage(senderId, chatId, messageType, payload, messageId);
  }

  protected async parseMessage(rawEvent: any): Promise<import('../../src/channels/BaseChannel.ts').ParsedMessage> {
    return this.parseMessageWithMedia(rawEvent.message);
  }

  private parseMessageWithMedia(message: any): import('../../src/channels/BaseChannel.ts').ParsedMessage {
    if (!message) return { content: '' };

    let content = '';
    const mediaSet = new Set<string>();
    const fileList: InboundFile[] = [];

    if (typeof message === 'string') {
      return { content: message };
    }

    if (Array.isArray(message)) {
      for (const seg of message) {
        const parsed = this.parseMessageSegment(seg);
        if (parsed.media) {
          for (const media of parsed.media) {
            if (media) mediaSet.add(media);
          }
        }
        if (parsed.files) {
          fileList.push(...parsed.files);
        }
        if (parsed.content) {
          content += parsed.content;
        }
      }
    }

    const media = Array.from(mediaSet);
    return {
      content: content.trim(),
      media: media.length > 0 ? media : undefined,
      files: fileList.length > 0 ? fileList : undefined
    };
  }

  private parseMessageSegment(seg: any): { content?: string; media?: string[]; files?: InboundFile[] } {
    if (!seg || typeof seg !== 'object') return { content: String(seg) };

    const type = seg.type;
    const data = seg.data || {};
    const handlers: Record<string, () => { content?: string; media?: string[]; files?: InboundFile[] }> = {
      text: () => MessageHandlers.text(data.text || ''),
      image: () => {
        const file = data.file || '';
        const url = data.url || '';
        const imageUrl = url || `file://${file}`;
        return MessageHandlers.image(imageUrl, url ? `[图片](${url})` : `[图片:${file}]`);
      },
      at: () => MessageHandlers.at(data.qq, data.qq === 'all'),
      record: () => {
        const url = data.url || data.file || '';
        return url ? MessageHandlers.audio(url) : { content: '[语音]' };
      },
      video: () => {
        const name = data.file || 'video';
        const url = data.url || '';
        return url ? MessageHandlers.video(url, name) : { content: `[视频: ${name}]` };
      },
      file: () => {
        const name = data.file || 'file';
        const url = data.url || '';
        return url ? MessageHandlers.file(url, name) : { content: `[文件: ${name}]` };
      },
      face: () => ({ content: `[表情:${data.id}]` }),
      reply: () => ({ content: `[回复:${data.id}]` }),
      rich: () => ({ content: `[富文本:${data.id || ''}]` })
    };

    const handler = handlers[type];
    return handler ? handler() : { content: `[${type}]` };
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.validateMessage(msg)) {
      return;
    }

    const isGroup = msg.messageType === 'group';
    const numericChatId = parseInt(msg.chatId, 10);
    if (Number.isNaN(numericChatId)) {
      this.log.warn(`Invalid chatId: ${msg.chatId}, must be numeric`);
      throw new Error(`Invalid chatId: must be numeric, got ${msg.chatId}`);
    }

    const segments = this.formatMessageWithBase64(msg.content, msg.media);
    if (segments.length === 0) {
      this.log.warn('No valid segments to send (content empty and no valid media)');
      return;
    }

    const action = isGroup ? 'send_group_msg' : 'send_private_msg';
    const params = isGroup
      ? { group_id: numericChatId, message: segments }
      : { user_id: numericChatId, message: segments };

    this.log.info(`Sending ${isGroup ? 'group' : 'private'} message to ${msg.chatId}`);
    try {
      await this.sendAction(action, params);
      metrics.record('channel.message_sent', 1, 'count', {
        channel: this.name,
        messageType: isGroup ? 'group' : 'private',
        status: 'success'
      });
      this.log.info(`Message sent to ${msg.chatId}`);
    } catch (error) {
      metrics.record('channel.message_sent', 1, 'count', {
        channel: this.name,
        messageType: isGroup ? 'group' : 'private',
        status: 'error'
      });
      throw error;
    }
  }

  private formatMessageWithBase64(content: string, media?: string[]): any[] {
    const segments: any[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      const imageMatch = remaining.match(/\[图片\]\(([^)]+)\)/);
      if (imageMatch) {
        const before = remaining.substring(0, imageMatch.index);
        if (before) {
          segments.push({ type: 'text', data: { text: before } });
        }
        const base64 = this.imageToBase64(imageMatch[1]);
        if (base64) {
          segments.push({ type: 'image', data: { file: `base64://${base64}` } });
        }
        remaining = remaining.substring((imageMatch.index ?? 0) + imageMatch[0].length);
        continue;
      }

      const atMatch = remaining.match(/@(\d+)/);
      if (atMatch) {
        const before = remaining.substring(0, atMatch.index);
        if (before) {
          segments.push({ type: 'text', data: { text: before } });
        }
        segments.push({ type: 'at', data: { qq: atMatch[1] } });
        remaining = remaining.substring((atMatch.index ?? 0) + atMatch[0].length);
        continue;
      }

      const maxLength = Math.min(remaining.length, CONSTANTS.MESSAGE_MAX_LENGTH);
      segments.push({ type: 'text', data: { text: remaining.substring(0, maxLength) } });
      break;
    }

    if (media && media.length > 0) {
      for (const mediaPath of media) {
        const base64 = this.imageToBase64(mediaPath);
        if (base64) {
          segments.push({ type: 'image', data: { file: `base64://${base64}` } });
        }
      }
    }

    return segments.length > 0 ? segments : [{ type: 'text', data: { text: content } }];
  }

  private readonly MAX_IMAGE_SIZE = CONSTANTS.MAX_IMAGE_SIZE;

  private imageToBase64(filePath: string): string | null {
    try {
      let path = filePath;
      if (filePath.startsWith('file://')) {
        path = filePath.substring(7);
      }
      if (fs.existsSync(path)) {
        const stats = fs.statSync(path);
        if (stats.size > this.MAX_IMAGE_SIZE) {
          this.log.warn(`Image too large: ${filePath} (${stats.size} bytes)`);
          return null;
        }
        const buffer = fs.readFileSync(path);
        return buffer.toString('base64');
      }
      this.log.warn(`File not found: ${filePath}`);
    } catch (error) {
      this.log.warn(`Failed to convert image to base64: ${filePath}`, error);
    }
    return null;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearHeartbeat();
    this.ws?.close();
    this.log.info('Channel stopped');
  }
}

const plugin: ChannelPluginDefinition = {
  pluginName: 'channel_onebot',
  channelName: 'onebot',
  create: (config, eventBus, workspace) => new OneBotChannel(config, eventBus, workspace)
};

export default plugin;
