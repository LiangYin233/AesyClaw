import WebSocket from 'ws';
import fs from 'fs';
import { basename } from 'path';
import { createHash, randomUUID } from 'crypto';
import type { ChannelPluginDefinition } from '../../src/channels/ChannelManager.ts';
import type { AdapterRuntimeContext, ChannelAdapter, ChannelSendContext } from '../../src/channels/core/adapter.ts';
import type {
  AdapterInboundDraft,
  AdapterSendResult,
  ChannelMessage,
  ChannelCapabilityProfile,
  MessageSegment,
  QuoteReference,
  ResourceHandle
} from '../../src/channels/core/types.ts';
import { logger } from '../../src/observability/index.ts';

const WEBSOCKET_ACTION_TIMEOUT = 10000;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

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

class OneBotAdapter implements ChannelAdapter {
  readonly name = 'onebot';
  private readonly FILE_UPLOAD_CHUNK_SIZE = 64 * 1024;
  private readonly FILE_UPLOAD_RETENTION_MS = 30 * 1000;
  private ws?: WebSocket;
  private runtimeContext?: AdapterRuntimeContext;
  private selfId?: string;
  private running = false;
  private connectAttemptCounter = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectBaseDelay: number;
  private reconnectMaxDelay: number;
  private heartbeatInterval?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private isReconnecting = false;
  private pendingActions: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = [];
  private log = logger.child('OneBot');

  constructor(private config: OneBotConfig) {
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 0;
    this.reconnectBaseDelay = config.reconnectBaseDelay ?? 1000;
    this.reconnectMaxDelay = config.reconnectMaxDelay ?? 30000;
  }

  capabilities(): ChannelCapabilityProfile {
    return {
      supportsMentions: true,
      supportsQuotes: true,
      supportsImages: true,
      supportsFiles: true,
      supportsAudio: true,
      supportsVideo: true
    };
  }

  async start(ctx: AdapterRuntimeContext): Promise<void> {
    this.runtimeContext = ctx;
    const startedAt = Date.now();
    await this.connectWebSocket();
    this.running = true;
    this.startHeartbeat();
    this.log.info('OneBot 渠道已启动', {
      wsUrl: this.config.wsUrl,
      durationMs: Date.now() - startedAt
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearHeartbeat();
    this.ws?.close();
    this.log.info('OneBot 渠道已停止');
  }

  isRunning(): boolean {
    return this.running;
  }

  async decodeInbound(rawEvent: any): Promise<AdapterInboundDraft | null> {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return null;
    }

    if (rawEvent.post_type === 'notice') {
      return this.decodeNoticeInbound(rawEvent);
    }

    if (rawEvent.post_type !== 'message') {
      return null;
    }

    if (this.shouldIgnoreMessageEvent(rawEvent)) {
      return null;
    }

    const messageType = rawEvent.message_type === 'group' ? 'group' : 'private';
    const senderId = rawEvent.user_id?.toString();
    const chatId = messageType === 'private'
      ? rawEvent.user_id?.toString()
      : rawEvent.group_id?.toString();

    if (!senderId || !chatId || !this.isAllowed(senderId, messageType)) {
      return null;
    }

    return {
      conversation: {
        id: chatId,
        type: messageType
      },
      sender: {
        id: senderId,
        displayName: rawEvent.sender?.card || rawEvent.sender?.nickname,
        isSelf: this.selfId ? senderId === this.selfId : false
      },
      timestamp: rawEvent.time ? new Date(rawEvent.time * 1000) : new Date(),
      platformMessageId: rawEvent.message_id?.toString(),
      segments: this.decodeSegments(rawEvent.message),
      metadata: {
        source: 'user'
      },
      rawEvent
    };
  }

  private buildResourceFromResponse(
    resource: ResourceHandle,
    response: any,
    payload: Record<string, any>
  ): ResourceHandle | null {
    const remoteUrl = response?.data?.url || response?.url;
    if (typeof remoteUrl !== 'string' || remoteUrl.length === 0) {
      return null;
    }

    return {
      ...resource,
      originalName: payload.file?.name || resource.originalName,
      remoteUrl,
      size: typeof payload.file?.size === 'number' ? payload.file.size : resource.size
    };
  }

  async resolveResource(resource: ResourceHandle, rawEvent?: unknown): Promise<ResourceHandle | null> {
    if (resource.localPath || resource.remoteUrl || !resource.platformFileId || !rawEvent || typeof rawEvent !== 'object') {
      return resource;
    }

    const payload = rawEvent as Record<string, any>;
    const noticeType = payload.notice_type;

    if (noticeType === 'offline_file') {
      const fileId = payload.file?.id;

      if (typeof fileId !== 'string') {
        return resource;
      }

      try {
        const response = await this.sendAction('get_private_file_url', {
          file_id: fileId
        });
        const result = this.buildResourceFromResponse(resource, response, payload);
        return result ?? resource;
      } catch (error) {
        this.log.warn('OneBot 私聊文件 URL 获取失败', {
          fileId,
          error: error instanceof Error ? error.message : String(error)
        });
        return resource;
      }
    }

    if (noticeType === 'group_upload') {
      const fileId = payload.file?.id;
      const busid = payload.file?.busid;
      const groupId = payload.group_id;

      if (typeof fileId !== 'string' || (typeof busid !== 'number' && typeof busid !== 'string') || (!groupId && groupId !== 0)) {
        return resource;
      }

      try {
        const response = await this.sendAction('get_group_file_url', {
          group_id: groupId,
          file_id: fileId,
          busid
        });
        const result = this.buildResourceFromResponse(resource, response, payload);
        return result ?? resource;
      } catch (error) {
        this.log.warn('OneBot 群聊文件 URL 获取失败', {
          fileId,
          groupId,
          error: error instanceof Error ? error.message : String(error)
        });
        return resource;
      }
    }

    return resource;
  }

  async fetchQuotedMessage(reference: QuoteReference): Promise<AdapterInboundDraft | null> {
    const messageId = reference.platformMessageId || reference.messageId;
    if (!messageId) {
      return null;
    }

    try {
      const response = await this.sendAction('get_msg', { message_id: messageId });
      const payload = response?.data;
      if (!payload) {
        return null;
      }

      const messageType = payload.message_type === 'group' ? 'group' : 'private';
      const senderId = payload.user_id?.toString();
      const chatId = messageType === 'private'
        ? payload.user_id?.toString()
        : payload.group_id?.toString();

      if (!senderId || !chatId) {
        return null;
      }

      return {
        conversation: {
          id: chatId,
          type: messageType
        },
        sender: {
          id: senderId,
          displayName: payload.sender?.card || payload.sender?.nickname,
          isSelf: this.selfId ? senderId === this.selfId : false
        },
        timestamp: payload.time ? new Date(payload.time * 1000) : new Date(),
        platformMessageId: payload.message_id?.toString(),
        segments: this.decodeSegments(payload.message),
        metadata: {
          source: 'quote'
        },
        rawEvent: payload
      };
    } catch (error) {
      this.log.warn('OneBot 引用消息获取失败', {
        messageId: messageId.toString(),
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async send(message: ChannelMessage, _context: ChannelSendContext): Promise<AdapterSendResult> {
    const isGroup = message.conversation.type === 'group';
    const numericChatId = parseInt(message.conversation.id, 10);
    if (Number.isNaN(numericChatId)) {
      throw new Error(`Invalid chatId: must be numeric, got ${message.conversation.id}`);
    }

    const outbound = this.buildOutbound(message);
    if (outbound.inlineSegments.length === 0 && outbound.filePaths.length === 0) {
      throw new Error('Outbound message rejected: empty payload');
    }

    let platformMessageId: string | undefined;

    if (outbound.inlineSegments.length > 0) {
      const action = isGroup ? 'send_group_msg' : 'send_private_msg';
      const params = isGroup
        ? { group_id: numericChatId, message: outbound.inlineSegments }
        : { user_id: numericChatId, message: outbound.inlineSegments };
      const response = await this.sendAction(action, params);
      platformMessageId = response?.data?.message_id?.toString();
    }

    for (const filePath of outbound.filePaths) {
      await this.uploadFile(numericChatId, isGroup, filePath);
    }

    return {
      platformMessageId
    };
  }

  classifyError(error: unknown): { retryable: boolean; code: string; message?: string } {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = /timeout|WebSocket not connected|ECONN|socket|network|temporarily/i.test(message);
    return {
      retryable,
      code: retryable ? 'transport_error' : 'send_failed',
      message
    };
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

      const clearSlowTimers = () => {
        for (const timer of slowTimers) {
          clearTimeout(timer);
        }
        slowTimers.length = 0;
      };

      const scheduleSlowLog = (delayMs: number) => {
        slowTimers.push(setTimeout(() => {
          this.log.warn('OneBot 连接仍在等待', {
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

      this.ws.on('open', async () => {
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        currentStage = 'websocket_open';

        try {
          const res = await this.sendAction('get_login_info', {});
          this.selfId = res.data?.user_id?.toString();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log.warn('OneBot 登录信息不可用', { error: message });
        } finally {
          clearSlowTimers();
          this.log.info('OneBot 握手完成', {
            attemptId,
            wsUrl: this.config.wsUrl,
            elapsedMs: Date.now() - connectStartedAt,
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
          this.log.error('解析 OneBot 消息失败', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });

      this.ws.on('close', () => {
        clearSlowTimers();
        this.clearHeartbeat();
        this.handleDisconnect();
      });

      this.ws.on('error', (error) => {
        clearSlowTimers();
        this.log.error('OneBot WebSocket 出错', {
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
    if (!this.running) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.flushPendingActions(true);

    const delay = Math.min(
      this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectMaxDelay
    );

    if (this.maxReconnectAttempts > 0 && this.reconnectAttempts > this.maxReconnectAttempts) {
      this.log.error('已达到 OneBot 重连上限', {
        maxReconnectAttempts: this.maxReconnectAttempts,
        wsUrl: this.config.wsUrl
      });
      this.running = false;
      return;
    }

    this.log.warn('已计划 OneBot 重连', {
      delayMs: delay,
      attempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts || undefined
    });

    setTimeout(() => {
      this.connectWebSocket().then(() => {
        this.log.info('OneBot 重连成功', { attempts: this.reconnectAttempts });
      }).catch((err: Error) => {
        this.log.error('OneBot 重连失败', { error: err.message, attempts: this.reconnectAttempts });
      });
    }, delay);
  }

  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval ?? 30000;
    this.heartbeatTimer = setTimeout(() => {
      void this.sendHeartbeat();
      this.heartbeatInterval = setInterval(() => {
        void this.sendHeartbeat();
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
              const errorMessage = response.wording || response.msg || response.message || 'Action failed';
              const retcode = response.retcode !== undefined ? ` (retcode=${response.retcode})` : '';
              settle(reject, new Error(`${errorMessage}${retcode}`));
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
      }, WEBSOCKET_ACTION_TIMEOUT);
    });
  }

  private handleOneBotEvent(payload: any): void {
    const postType = payload.post_type;

    if (postType === 'message') {
      void this.handleMessageEvent(payload);
      return;
    }

    if (postType === 'notice') {
      void this.handleNoticeEvent(payload);
    }
  }

  private async handleNoticeEvent(payload: any): Promise<void> {
    const noticeType = payload.notice_type;
    if (noticeType !== 'offline_file' && noticeType !== 'group_upload') {
      return;
    }

    try {
      await this.runtimeContext?.ingest(payload);
    } catch (error) {
      this.log.error('OneBot 文件通知分发失败', {
        noticeType,
        userId: payload.user_id?.toString(),
        groupId: payload.group_id?.toString(),
        fileName: payload.file?.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private decodeNoticeInbound(payload: any): AdapterInboundDraft | null {
    const noticeType = payload.notice_type;
    const senderId = payload.user_id?.toString();

    if (noticeType === 'offline_file') {
      if (!senderId || !this.isAllowed(senderId, 'private')) {
        return null;
      }

      return {
        conversation: {
          id: senderId,
          type: 'private'
        },
        sender: {
          id: senderId,
          isSelf: this.selfId ? senderId === this.selfId : false
        },
        timestamp: payload.time ? new Date(payload.time * 1000) : new Date(),
        segments: [
          {
            type: 'file',
            resource: {
              resourceId: randomUUID().slice(0, 8),
              kind: 'file',
              originalName: payload.file?.name || 'file',
              remoteUrl: typeof payload.file?.url === 'string' ? payload.file.url : undefined,
              size: typeof payload.file?.size === 'number' ? payload.file.size : undefined,
              platformFileId: typeof payload.file?.url === 'string' ? undefined : payload.file?.name
            }
          }
        ],
        metadata: {
          source: 'user',
          noticeType
        },
        rawEvent: payload
      };
    }

    if (noticeType === 'group_upload') {
      const groupId = payload.group_id?.toString();
      const fileId = payload.file?.id;

      if (!senderId || !groupId || typeof fileId !== 'string' || !this.isAllowed(senderId, 'group')) {
        return null;
      }

      return {
        conversation: {
          id: groupId,
          type: 'group'
        },
        sender: {
          id: senderId,
          isSelf: this.selfId ? senderId === this.selfId : false
        },
        timestamp: payload.time ? new Date(payload.time * 1000) : new Date(),
        segments: [
          {
            type: 'file',
            resource: {
              resourceId: randomUUID().slice(0, 8),
              kind: 'file',
              originalName: payload.file?.name || 'file',
              size: typeof payload.file?.size === 'number' ? payload.file.size : undefined,
              platformFileId: fileId
            }
          }
        ],
        metadata: {
          source: 'user',
          noticeType
        },
        rawEvent: payload
      };
    }

    return null;
  }

  private shouldIgnoreMessageEvent(payload: any): boolean {
    const senderId = payload.user_id?.toString();
    const rawText = this.extractInboundRawText(payload);

    if (senderId && this.selfId && senderId === this.selfId) {
      this.log.debug('OneBot self message ignored', {
        messageId: payload.message_id?.toString(),
        messageType: payload.message_type,
        subType: payload.sub_type
      });
      return true;
    }

    if (rawText.trim().length === 0) {
      this.log.debug('OneBot empty message ignored', {
        messageId: payload.message_id?.toString(),
        messageType: payload.message_type,
        subType: payload.sub_type,
        senderId
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

  private extractInboundRawText(payload: any): string {
    if (typeof payload?.raw_message === 'string') {
      return payload.raw_message;
    }

    if (typeof payload?.message === 'string') {
      return payload.message;
    }

    if (!Array.isArray(payload?.message)) {
      return '';
    }

    return payload.message.map((segment: any) => {
      if (!segment || typeof segment !== 'object') {
        return String(segment ?? '');
      }

      const type = segment.type;
      const data = segment.data || {};

      switch (type) {
        case 'text':
          return data.text || '';
        case 'file':
          return `[file:${data.name || data.file || ''}]`;
        case 'image':
          return `[image:${data.file || data.url || ''}]`;
        case 'record':
          return `[record:${data.file || data.url || ''}]`;
        case 'video':
          return `[video:${data.file || data.url || ''}]`;
        case 'reply':
          return `[reply:${data.id || ''}]`;
        case 'at':
          return `[@${data.qq || ''}]`;
        default:
          return `[${type}]`;
      }
    }).join('');
  }

  private async handleMessageEvent(payload: any): Promise<void> {
    if (this.shouldIgnoreMessageEvent(payload)) {
      return;
    }

    try {
      await this.runtimeContext?.ingest(payload);
    } catch (error) {
      this.log.error('OneBot 入站消息分发失败', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private isAllowed(senderId: string, messageType?: 'private' | 'group'): boolean {
    if (messageType === 'group') {
      const groupAllowFrom = this.config.groupAllowFrom;
      if (!groupAllowFrom || groupAllowFrom.length === 0) {
        return true;
      }
      return groupAllowFrom.includes(senderId);
    }

    const friendAllowFrom = this.config.friendAllowFrom;
    if (!friendAllowFrom || friendAllowFrom.length === 0) {
      return true;
    }
    return friendAllowFrom.includes(senderId);
  }

  private decodeSegments(message: any): MessageSegment[] {
    if (!message) {
      return [];
    }

    if (typeof message === 'string') {
      return [{ type: 'text', text: message }];
    }

    if (!Array.isArray(message)) {
      return [{ type: 'unsupported', originalType: typeof message, text: String(message) }];
    }

    return message.map((seg) => this.decodeSegment(seg)).filter((segment): segment is MessageSegment => !!segment);
  }

  private decodeSegment(seg: any): MessageSegment | null {
    if (!seg || typeof seg !== 'object') {
      return { type: 'text', text: String(seg ?? '') };
    }

    const type = seg.type;
    const data = seg.data || {};

    switch (type) {
      case 'text':
        return { type: 'text', text: data.text || '' };
      case 'at':
        return {
          type: 'mention',
          userId: data.qq?.toString() || 'unknown',
          display: data.qq === 'all' ? '全体成员' : data.qq?.toString()
        };
      case 'reply':
        return {
          type: 'quote',
          reference: { platformMessageId: data.id?.toString() }
        };
      case 'image':
        return { type: 'image', resource: this.buildResource('image', data.file || data.url || 'image', data.url) };
      case 'record':
        return { type: 'audio', resource: this.buildResource('audio', data.file || data.url || 'voice.amr', data.url) };
      case 'video':
        return { type: 'video', resource: this.buildResource('video', data.file || data.url || 'video.mp4', data.url) };
      case 'file':
        return { type: 'file', resource: this.buildResource('file', data.file || data.url || 'file', data.url) };
      case 'face':
        return { type: 'unsupported', originalType: 'face', text: `[表情:${data.id}]` };
      case 'rich':
        return { type: 'unsupported', originalType: 'rich', text: `[富文本:${data.id || ''}]` };
      default:
        return { type: 'unsupported', originalType: type, text: `[${type}]` };
    }
  }

  private buildResource(kind: ResourceHandle['kind'], fileOrUrl: string, preferredUrl?: string): ResourceHandle {
    const resourceId = randomUUID().slice(0, 8);
    const fileName = basename((preferredUrl || fileOrUrl || `${kind}-${resourceId}`).replace(/^file:\/\//, '')) || `${kind}-${resourceId}`;
    const localPath = this.normalizeLocalFile(fileOrUrl);
    const remoteUrl = preferredUrl || this.normalizeRemoteUrl(fileOrUrl);

    return {
      resourceId,
      kind,
      originalName: fileName,
      remoteUrl,
      localPath,
      platformFileId: fileOrUrl && !remoteUrl && !localPath ? fileOrUrl : undefined
    };
  }

  private normalizeRemoteUrl(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('file://')) {
      return value;
    }
    return undefined;
  }

  private normalizeLocalFile(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('base64://')) {
      return undefined;
    }

    if (value.startsWith('file://')) {
      return value.substring(7);
    }

    const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(value);
    const isUnixAbsolute = value.startsWith('/');
    const isUncPath = value.startsWith('\\\\');
    const isExplicitRelative = value.startsWith('./')
      || value.startsWith('../')
      || value.startsWith('.\\')
      || value.startsWith('..\\');

    if (!isWindowsAbsolute && !isUnixAbsolute && !isUncPath && !isExplicitRelative) {
      return undefined;
    }

    return value;
  }

  private buildOutbound(message: ChannelMessage): { inlineSegments: any[]; filePaths: string[] } {
    const inlineSegments: any[] = [];
    const filePaths: string[] = [];

    for (const segment of message.segments) {
      switch (segment.type) {
        case 'quote': {
          const replyId = segment.reference.platformMessageId || segment.reference.messageId;
          if (replyId) {
            inlineSegments.push({ type: 'reply', data: { id: replyId } });
          }
          break;
        }
        case 'text':
          if (segment.text) {
            inlineSegments.push({ type: 'text', data: { text: segment.text } });
          }
          break;
        case 'mention':
          inlineSegments.push({ type: 'at', data: { qq: segment.userId === 'all' ? 'all' : segment.userId } });
          break;
        case 'image': {
          const image = this.resourceToImageSegment(segment.resource);
          if (image) {
            inlineSegments.push(image);
          }
          break;
        }
        case 'file':
        case 'audio':
        case 'video': {
          const filePath = this.resourceToLocalPath(segment.resource);
          if (filePath) {
            filePaths.push(filePath);
          }
          break;
        }
        case 'unsupported':
          if (segment.text) {
            inlineSegments.push({ type: 'text', data: { text: segment.text } });
          }
          break;
        default:
          break;
      }
    }

    return { inlineSegments, filePaths };
  }

  private resourceToImageSegment(resource: ResourceHandle): any | null {
    const localPath = this.resourceToLocalPath(resource);
    if (localPath) {
      const base64 = this.imageToBase64(localPath);
      if (base64) {
        return { type: 'image', data: { file: `base64://${base64}` } };
      }
    }

    if (resource.remoteUrl) {
      return { type: 'image', data: { file: resource.remoteUrl } };
    }

    return null;
  }

  private resourceToLocalPath(resource: ResourceHandle): string | undefined {
    if (resource.localPath) {
      return this.normalizeLocalPath(resource.localPath);
    }
    if (resource.remoteUrl?.startsWith('file://')) {
      return this.normalizeLocalPath(resource.remoteUrl);
    }
    return undefined;
  }

  private async uploadFile(chatId: number, isGroup: boolean, filePath: string): Promise<void> {
    const normalizedPath = this.normalizeLocalPath(filePath);

    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const uploadedPath = await this.uploadFileStream(normalizedPath);

    const action = isGroup ? 'upload_group_file' : 'upload_private_file';
    const params = isGroup
      ? { group_id: chatId, file: uploadedPath, name: basename(normalizedPath) }
      : { user_id: chatId, file: uploadedPath, name: basename(normalizedPath) };

    await this.sendAction(action, params);
  }

  private async uploadFileStream(filePath: string): Promise<string> {
    const fileName = basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const totalChunks = Math.max(1, Math.ceil(fileSize / this.FILE_UPLOAD_CHUNK_SIZE));
    const expectedSha256 = this.calculateFileSha256(filePath);
    const streamId = randomUUID();

    this.log.info('OneBot 流式上传开始', {
      fileName,
      fileSize,
      totalChunks
    });

    const fd = fs.openSync(filePath, 'r');
    try {
      let chunkIndex = 0;
      let position = 0;

      while (position < fileSize || (fileSize === 0 && chunkIndex === 0)) {
        const length = fileSize === 0
          ? 0
          : Math.min(this.FILE_UPLOAD_CHUNK_SIZE, fileSize - position);
        const buffer = Buffer.alloc(length);
        const bytesRead = fileSize === 0 ? 0 : fs.readSync(fd, buffer, 0, length, position);

        await this.sendAction('upload_file_stream', {
          stream_id: streamId,
          chunk_data: buffer.subarray(0, bytesRead).toString('base64'),
          chunk_index: chunkIndex,
          total_chunks: totalChunks,
          file_size: fileSize,
          expected_sha256: expectedSha256,
          filename: fileName,
          file_retention: this.FILE_UPLOAD_RETENTION_MS
        });

        position += bytesRead;
        chunkIndex += 1;

        if (fileSize === 0) {
          break;
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    const response = await this.sendAction('upload_file_stream', {
      stream_id: streamId,
      is_complete: true
    });
    const result = response?.data;

    if (result?.status !== 'file_complete' || typeof result.file_path !== 'string' || result.file_path.length === 0) {
      throw new Error(`Stream upload incomplete: ${JSON.stringify(result)}`);
    }

    this.log.info('OneBot 流式上传完成', {
      fileName,
      fileSize,
      filePath: result.file_path
    });

    return result.file_path;
  }

  private calculateFileSha256(filePath: string): string {
    const hash = createHash('sha256');
    const fd = fs.openSync(filePath, 'r');

    try {
      const buffer = Buffer.alloc(this.FILE_UPLOAD_CHUNK_SIZE);
      let bytesRead = 0;
      let position = 0;

      do {
        bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
        if (bytesRead > 0) {
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
      } while (bytesRead > 0);
    } finally {
      fs.closeSync(fd);
    }

    return hash.digest('hex');
  }

  private readonly MAX_IMAGE_SIZE = MAX_IMAGE_SIZE;

  private normalizeLocalPath(filePath: string): string {
    return filePath.startsWith('file://') ? filePath.substring(7) : filePath;
  }

  private imageToBase64(filePath: string): string | null {
    try {
      const path = this.normalizeLocalPath(filePath);
      if (fs.existsSync(path)) {
        const stats = fs.statSync(path);
        if (stats.size > this.MAX_IMAGE_SIZE) {
          this.log.warn(`图片过大: ${filePath} (${stats.size} 字节)`);
          return null;
        }
        const buffer = fs.readFileSync(path);
        return buffer.toString('base64');
      }
      this.log.warn(`文件不存在: ${filePath}`);
    } catch (error) {
      this.log.warn(`图片转 base64 失败: ${filePath}`, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  }
}

const plugin: ChannelPluginDefinition = {
  pluginName: 'channel_onebot',
  channelName: 'onebot',
  create: (config) => new OneBotAdapter(config)
};

export default plugin;
