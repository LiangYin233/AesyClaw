import WebSocket from 'ws';
import fs from 'fs';
import { BaseChannel } from './BaseChannel.js';
import { ChannelManager, type ChannelPlugin } from './ChannelManager.js';
import type { OutboundMessage } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';
import { parseMessageSegment, formatMessageWithBase64 } from '../utils/index.js';

export interface OneBotConfig {
  wsUrl: string;
  token?: string;
  friendAllowFrom?: string[];
  groupAllowFrom?: string[];
  maxReconnectAttempts?: number;
  reconnectBaseDelay?: number;
  reconnectMaxDelay?: number;
  heartbeatInterval?: number;
}

export class OneBotChannel extends BaseChannel {
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

  constructor(config: OneBotConfig, eventBus: EventBus) {
    super(config, eventBus);
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 0;
    this.reconnectBaseDelay = config.reconnectBaseDelay ?? 1000;
    this.reconnectMaxDelay = config.reconnectMaxDelay ?? 30000;
  }

  static register(): void {
    const plugin: ChannelPlugin = {
      name: 'onebot',
      create: (config, eventBus) => new OneBotChannel(config, eventBus)
    };
    ChannelManager.registerPlugin(plugin);
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
        headers['Authorization'] = `Bearer ${this.config.token}`;
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
      : this.reconnectAttempts > 1 ? ` (attempt ${this.reconnectAttempts})`
      : '';
    this.log.info(`Reconnecting in ${delay}ms${attemptMsg}`);

    setTimeout(() => {
      this.connectWebSocket().then(() => {
        this.log.info('Reconnected successfully');
      }).catch((err) => {
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
      // Ignore heartbeat errors
    }
  }

  private flushPendingActions(reject = false): void {
    const pending = [...this.pendingActions];
    this.pendingActions = [];
    for (const { resolve, reject: rej } of pending) {
      if (reject) {
        rej(new Error('WebSocket reconnected'));
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
        }
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = Date.now();
      const message = JSON.stringify({
        action,
        params,
        echo: id
      });

      let settled = false;
      const settle = (fn: (value: any) => void, value: any) => {
        if (!settled) {
          settled = true;
          this.ws?.off('message', handler);
          fn(value);
        }
      };

      const handler = (data: any) => {
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
      this.ws.send(message);

      setTimeout(() => {
        if (!settled) {
          settle(reject, new Error('Action timeout'));
        }
      }, CONSTANTS.WEBSOCKET_ACTION_TIMEOUT);
    });
  }

  private handleOneBotEvent(payload: any): void {
    const postType = payload.post_type;

    if (postType === 'message') {
      this.handleMessageEvent(payload);
    } else if (postType === 'notice') {
      this.log.debug(`Notice: ${payload.notice_type}`);
    } else if (postType === 'request') {
      this.log.debug(`Request: ${payload.request_type}`);
    }
  }

  private handleMessageEvent(payload: any): void {
    const messageType = payload.message_type;
    const userId = payload.user_id;
    const groupId = payload.group_id;

    const senderId = userId?.toString();
    const chatId = messageType === 'private'
      ? userId?.toString()
      : groupId?.toString();

    if (!senderId || !chatId) return;

    if (!this.isAllowed(senderId, messageType)) {
      this.log.debug(`Message denied from: ${senderId} (${messageType})`);
      return;
    }

    const { content, media } = this.parseMessageWithMedia(payload.message);
    if (this.log.isLevelEnabled?.('debug')) {
      this.log.debug(`Parsed message: content="${content}", media=${JSON.stringify(media)}`);
    }
    const messageId = payload.message_id?.toString();

    this.handleMessage(senderId, chatId, content, payload, messageId, messageType, media);
  }

  private parseMessageWithMedia(message: any): { content: string; media?: string[] } {
    if (!message) return { content: '' };
    
    let content = '';
    const mediaSet = new Set<string>();
    
    if (typeof message === 'string') {
      return { content: message };
    }

    if (Array.isArray(message)) {
      for (const seg of message) {
        const parsed = parseMessageSegment(seg);
        if (parsed.media) {
          for (const m of parsed.media) {
            if (m) mediaSet.add(m);
          }
        }
        if (parsed.text) {
          content += parsed.text;
        }
      }
    }

    const media = Array.from(mediaSet);
    return { content: content.trim(), media: media.length > 0 ? media : undefined };
  }

  async send(msg: OutboundMessage): Promise<void> {
    // 验证消息是否为空
    if (!this.validateMessage(msg)) {
      return; // 取消发送
    }

    const chatId = msg.chatId;
    const isGroup = msg.messageType === 'group';

    const numericChatId = parseInt(chatId, 10);
    if (isNaN(numericChatId)) {
      this.log.warn(`Invalid chatId: ${chatId}, must be numeric`);
      throw new Error(`Invalid chatId: must be numeric, got ${chatId}`);
    }

    const segments = formatMessageWithBase64(
      msg.content,
      msg.media,
      this.imageToBase64.bind(this),
      CONSTANTS.MESSAGE_MAX_LENGTH
    );

    if (segments.length === 0) {
      this.log.warn(`No valid segments to send (content empty and no valid media)`);
      return;
    }

    if (msg.media && msg.media.length > 0) {
      this.log.debug(`Processing ${msg.media.length} media files: ${msg.media.join(', ')}`);
    }

    const action = isGroup ? 'send_group_msg' : 'send_private_msg';
    const params = isGroup
      ? { group_id: numericChatId, message: segments }
      : { user_id: numericChatId, message: segments };

    this.log.info(`Sending ${isGroup ? 'group' : 'private'} message to ${chatId}`);
    if (this.log.isLevelEnabled?.('debug')) {
      const logSegments = JSON.stringify(segments).replace(/"file":"base64:\/\/([A-Za-z0-9+/=]{10})[A-Za-z0-9+/=]*"/g, '"file":"base64://$1...(truncated)"');
      this.log.debug(`Message segments:`, logSegments);
    }
    await this.sendAction(action, params);

    this.log.info(`Message sent to ${chatId}`);
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
        this.log.debug(`Converted ${filePath} to base64 (${buffer.length} bytes)`);
        return buffer.toString('base64');
      } else {
        this.log.warn(`File not found: ${filePath}`);
      }
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
