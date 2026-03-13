import WebSocket from 'ws';
import fs from 'fs';
import { basename } from 'path';
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
  private connectAttemptCounter = 0;
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
    const startedAt = Date.now();
    await this.connectWebSocket();
    this.running = true;
    this.startHeartbeat();
    this.log.info('OneBot channel started', {
      wsUrl: this.config.wsUrl,
      durationMs: Date.now() - startedAt
    });
  }

  private async connectWebSocket(): Promise<void> {
    const connectStartedAt = Date.now();
    return new Promise((resolve, reject) => {
      const attemptId = ++this.connectAttemptCounter;
      const parsedUrl = new URL(this.config.wsUrl);
      const targetHost = parsedUrl.hostname;
      const targetPort = parsedUrl.port || (parsedUrl.protocol === 'wss:' ? '443' : '80');
      const slowTimers: NodeJS.Timeout[] = [];
      let currentStage = 'init';
      let socketAssignedMs: number | undefined;
      let dnsLookupMs: number | undefined;
      let tcpConnectMs: number | undefined;
      let httpUpgradeMs: number | undefined;

      const clearSlowTimers = () => {
        for (const timer of slowTimers) {
          clearTimeout(timer);
        }
        slowTimers.length = 0;
      };

      const scheduleSlowLog = (delayMs: number) => {
        slowTimers.push(setTimeout(() => {
          this.log.warn('OneBot connection still pending', {
            attemptId,
            elapsedMs: Date.now() - connectStartedAt,
            stage: currentStage,
            host: targetHost,
            port: targetPort,
            reconnecting: this.isReconnecting
          });
        }, delayMs));
      };

      scheduleSlowLog(1000);
      scheduleSlowLog(5000);
      scheduleSlowLog(15000);

      const headers: Record<string, string> = {};
      if (this.config.token) {
        headers.Authorization = `Bearer ${this.config.token}`;
      }

      this.ws = new WebSocket(this.config.wsUrl, { headers });

      const request = (this.ws as any)?._req;
      if (request?.on) {
        request.on('socket', (socket: any) => {
          currentStage = 'socket_assigned';
          socketAssignedMs = Date.now() - connectStartedAt;
          this.log.debug('OneBot socket assigned', {
            attemptId,
            elapsedMs: socketAssignedMs,
            host: targetHost,
            port: targetPort
          });

          socket.once('lookup', (error: Error | null, address: string, family: number, host: string) => {
            currentStage = 'dns_resolved';
            dnsLookupMs = Date.now() - connectStartedAt;
            this.log.debug('OneBot DNS resolved', {
              attemptId,
              elapsedMs: dnsLookupMs,
              address,
              family,
              host,
              error: error?.message
            });
          });

          socket.once('connect', () => {
            currentStage = 'tcp_connected';
            tcpConnectMs = Date.now() - connectStartedAt;
            this.log.debug('OneBot TCP connected', {
              attemptId,
              elapsedMs: tcpConnectMs,
              localAddress: socket.localAddress,
              localPort: socket.localPort,
              remoteAddress: socket.remoteAddress,
              remotePort: socket.remotePort
            });
          });

          socket.once('timeout', () => {
            this.log.warn('OneBot socket timeout', {
              attemptId,
              elapsedMs: Date.now() - connectStartedAt,
              stage: currentStage,
              host: targetHost,
              port: targetPort
            });
          });

          socket.once('close', (hadError: boolean) => {
            this.log.debug('OneBot socket closed', {
              attemptId,
              elapsedMs: Date.now() - connectStartedAt,
              stage: currentStage,
              hadError
            });
          });
        });
      }

      this.ws.on('upgrade', (response: any) => {
        currentStage = 'http_upgrade';
        httpUpgradeMs = Date.now() - connectStartedAt;
        this.log.debug('OneBot HTTP upgrade completed', {
          attemptId,
          elapsedMs: httpUpgradeMs,
          statusCode: response?.statusCode,
          statusMessage: response?.statusMessage
        });
      });

      this.ws.on('unexpected-response', (_request: any, response: any) => {
        currentStage = 'unexpected_response';
        clearSlowTimers();
        this.log.warn('OneBot unexpected HTTP response', {
          attemptId,
          elapsedMs: Date.now() - connectStartedAt,
          statusCode: response?.statusCode,
          statusMessage: response?.statusMessage,
          host: targetHost,
          port: targetPort
        });
      });

      this.ws.on('open', async () => {
        const websocketOpenMs = Date.now() - connectStartedAt;
        const loginInfoStartedAt = Date.now();
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        currentStage = 'websocket_open';

        try {
          const res = await this.sendAction('get_login_info', {});
          this.selfId = res.data?.user_id?.toString();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log.warn('OneBot login info unavailable', { error: message });
        } finally {
          clearSlowTimers();
          this.log.info('OneBot handshake completed', {
            attemptId,
            socketAssignedMs,
            dnsLookupMs,
            tcpConnectMs,
            httpUpgradeMs,
            wsUrl: this.config.wsUrl,
            websocketOpenMs,
            loginInfoMs: Date.now() - loginInfoStartedAt,
            hasSelfId: !!this.selfId,
            selfId: this.selfId
          });
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
        clearSlowTimers();
        this.clearHeartbeat();
        this.handleDisconnect();
      });

      this.ws.on('error', (error) => {
        clearSlowTimers();
        this.log.error('OneBot websocket error', {
          attemptId,
          elapsedMs: Date.now() - connectStartedAt,
          stage: currentStage,
          host: targetHost,
          port: targetPort,
          error: error.message
        });
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
      this.log.error('OneBot reconnect limit reached', {
        maxReconnectAttempts: this.maxReconnectAttempts,
        wsUrl: this.config.wsUrl
      });
      this.running = false;
      return;
    }

    const attemptMsg = this.maxReconnectAttempts > 0
      ? ` (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      : this.reconnectAttempts > 1 ? ` (attempt ${this.reconnectAttempts})` : '';
    this.log.warn('OneBot reconnect scheduled', {
      delayMs: delay,
      attempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts || undefined
    });

    setTimeout(() => {
      this.connectWebSocket().then(() => {
        this.log.info('OneBot reconnect succeeded', { attempts: this.reconnectAttempts });
      }).catch((err: Error) => {
        this.log.error('OneBot reconnect failed', { error: err.message, attempts: this.reconnectAttempts });
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
          this.log.debug('OneBot response parse skipped', { error });
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
      return;
    }

    if (postType === 'notice') {
      this.handleNoticeEvent(payload);
    }
  }

  private handleNoticeEvent(payload: any): void {
    const noticeType = payload.notice_type;

    if (noticeType === 'offline_file' || noticeType === 'group_upload') {
      this.log.debug('OneBot file notice ignored', {
        noticeType,
        userId: payload.user_id?.toString(),
        groupId: payload.group_id?.toString(),
        fileName: payload.file?.name
      });
    }
  }

  private shouldIgnoreMessageEvent(payload: any): boolean {
    const senderId = payload.user_id?.toString();

    if (senderId && this.selfId && senderId === this.selfId) {
      this.log.debug('OneBot self message ignored', {
        messageId: payload.message_id?.toString(),
        messageType: payload.message_type,
        subType: payload.sub_type
      });
      return true;
    }

    if (payload.sub_type === 'notice') {
      this.log.debug('OneBot notice message ignored', {
        messageId: payload.message_id?.toString(),
        messageType: payload.message_type
      });
      return true;
    }

    return false;
  }

  private async handleMessageEvent(payload: any): Promise<void> {
    if (this.shouldIgnoreMessageEvent(payload)) {
      return;
    }

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
      this.log.warn('OneBot outbound chatId invalid', { chatId: msg.chatId });
      throw new Error(`Invalid chatId: must be numeric, got ${msg.chatId}`);
    }

    try {
      const segments = this.formatMessageWithBase64(msg.content, msg.media);
      if (segments.length > 0) {
        const action = isGroup ? 'send_group_msg' : 'send_private_msg';
        const params = isGroup
          ? { group_id: numericChatId, message: segments }
          : { user_id: numericChatId, message: segments };

        await this.sendAction(action, params);
      }

      if (msg.files) {
        for (const filePath of msg.files) {
          await this.uploadFile(numericChatId, isGroup, filePath);
        }
      }

      metrics.record('channel.message_sent', 1, 'count', {
        channel: this.name,
        messageType: isGroup ? 'group' : 'private',
        status: 'success'
      });
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

    if (segments.length > 0) {
      return segments;
    }

    if (content.trim().length > 0) {
      return [{ type: 'text', data: { text: content } }];
    }

    return [];
  }

  private async uploadFile(chatId: number, isGroup: boolean, filePath: string): Promise<void> {
    const normalizedPath = this.normalizeLocalPath(filePath);

    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const action = isGroup ? 'upload_group_file' : 'upload_private_file';
    const params = isGroup
      ? { group_id: chatId, file: normalizedPath, name: basename(normalizedPath) }
      : { user_id: chatId, file: normalizedPath, name: basename(normalizedPath) };

    await this.sendAction(action, params);
  }

  private readonly MAX_IMAGE_SIZE = CONSTANTS.MAX_IMAGE_SIZE;

  private normalizeLocalPath(filePath: string): string {
    return filePath.startsWith('file://') ? filePath.substring(7) : filePath;
  }

  private imageToBase64(filePath: string): string | null {
    try {
      const path = this.normalizeLocalPath(filePath);
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
    this.log.info('OneBot channel stopped');
  }
}

const plugin: ChannelPluginDefinition = {
  pluginName: 'channel_onebot',
  channelName: 'onebot',
  create: (config, eventBus, workspace) => new OneBotChannel(config, eventBus, workspace)
};

export default plugin;
