import WebSocket from 'ws';
import fs from 'fs';
import { basename } from 'path';
import { createHash, randomUUID } from 'crypto';
import { BaseChannelAdapter } from '../../src/features/channels/adapter/BaseChannelAdapter.js';
import type { SendResult } from '../../src/features/channels/protocol/adapter-interface.js';
import type { UnifiedMessage } from '../../src/features/channels/protocol/unified-message.js';
import type { ImageAttachment, FileAttachment } from '../../src/features/channels/protocol/attachment.js';

const WEBSOCKET_ACTION_TIMEOUT = 10000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 0;
const DEFAULT_RECONNECT_BASE_DELAY = 1000;
const DEFAULT_RECONNECT_MAX_DELAY = 30000;
const DEFAULT_HEARTBEAT_INTERVAL = 30000;

interface OneBotConfig {
  wsUrl: string;
  token?: string;
  friendAllowFrom?: string[];
  groupAllowFrom?: string[];
}

export const defaultChannelConfig: Partial<OneBotConfig> = {
  wsUrl: '',
  token: '',
  friendAllowFrom: [],
  groupAllowFrom: []
};

class OneBotAdapter extends BaseChannelAdapter {
  readonly name = 'onebot';
  private readonly FILE_UPLOAD_CHUNK_SIZE = 64 * 1024;
  private readonly FILE_UPLOAD_RETENTION_MS = 30 * 1000;
  private ws?: WebSocket;
  private selfId?: string;
  private reconnectAttempts = 0;
  private heartbeatInterval?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private isReconnecting = false;
  private running = false;
  private pendingActions: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = [];

  constructor(private config: OneBotConfig) {
    super();
  }

  protected async onStart(): Promise<void> {
    await this.connectWebSocket();
    this.running = true;
    this.startHeartbeat();
  }

  protected async onStop(): Promise<void> {
    this.running = false;
    this.clearHeartbeat();
    this.ws?.close();
  }

  protected async parsePlatformEvent(rawEvent: unknown): Promise<UnifiedMessage | null> {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return null;
    }

    const event = rawEvent as any;

    // 处理通知类型
    if (event.post_type === 'notice') {
      return this.parseNoticeEvent(event);
    }

    // 只处理消息类型
    if (event.post_type !== 'message') {
      return null;
    }

    // 忽略自己的消息和无效消息
    if (this.shouldIgnoreMessage(event)) {
      return null;
    }

    const messageType = event.message_type === 'group' ? 'group' : 'private';
    const senderId = event.user_id?.toString();
    const chatId = messageType === 'private'
      ? event.user_id?.toString()
      : event.group_id?.toString();

    if (!senderId || !chatId || !this.isAllowed(senderId, messageType)) {
      return null;
    }

    // 解析消息内容
    const { text, images, files } = this.parseMessageContent(event.message);

    return {
      id: event.message_id?.toString() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      channel: 'onebot',
      direction: 'inbound',
      chatId,
      chatType: messageType,
      senderId,
      senderName: event.sender?.card || event.sender?.nickname,
      isSelf: this.selfId ? senderId === this.selfId : false,
      text,
      images,
      files,
      timestamp: event.time ? new Date(event.time * 1000) : new Date(),
      raw: event
    };
  }

  protected async sendToPlatform(message: UnifiedMessage): Promise<SendResult> {
    const isGroup = message.chatType === 'group';
    const numericChatId = parseInt(message.chatId, 10);
    if (Number.isNaN(numericChatId)) {
      throw new Error(`Invalid chatId: must be numeric, got ${message.chatId}`);
    }

    const messageChain: any[] = [];

    // 处理回复
    if (message.replyTo) {
      messageChain.push({ type: 'reply', data: { id: message.replyTo } });
    }

    // 处理文本
    if (message.text) {
      messageChain.push({ type: 'text', data: { text: message.text } });
    }

    // 处理图片
    for (const image of message.images) {
      const imageSegment = await this.createImageSegment(image);
      if (imageSegment) {
        messageChain.push(imageSegment);
      }
    }

    // 处理文件
    for (const file of message.files) {
      if (file.url) {
        await this.uploadFile(numericChatId, isGroup, file.url);
      }
    }

    if (messageChain.length === 0 && message.files.length === 0) {
      return { success: false, error: 'Empty message' };
    }

    let platformMessageId: string | undefined;

    // 发送消息链
    if (messageChain.length > 0) {
      const action = isGroup ? 'send_group_msg' : 'send_private_msg';
      const params = isGroup
        ? { group_id: numericChatId, message: messageChain }
        : { user_id: numericChatId, message: messageChain };
      
      try {
        const response = await this.sendAction(action, params);
        platformMessageId = response?.data?.message_id?.toString();
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return { success: true, messageId: platformMessageId };
  }

  private parseMessageContent(message: any): { text: string; images: ImageAttachment[]; files: FileAttachment[] } {
    const images: ImageAttachment[] = [];
    const files: FileAttachment[] = [];
    let text = '';

    if (typeof message === 'string') {
      text = message;
    } else if (Array.isArray(message)) {
      for (const seg of message) {
        if (!seg || typeof seg !== 'object') continue;

        const type = seg.type;
        const data = seg.data || {};

        switch (type) {
          case 'text':
            text += data.text || '';
            break;
          case 'image':
            images.push({
              id: randomUUID().slice(0, 8),
              type: 'image',
              name: data.file || data.url || 'image.png',
              url: data.url || ''
            });
            break;
          case 'file':
            files.push({
              id: randomUUID().slice(0, 8),
              type: 'file',
              name: data.name || data.file || 'file',
              url: data.path || ''
            });
            break;
          case 'record':
            files.push({
              id: randomUUID().slice(0, 8),
              type: 'audio',
              name: data.file || 'voice.amr',
              url: data.path || ''
            });
            break;
          case 'video':
            files.push({
              id: randomUUID().slice(0, 8),
              type: 'video',
              name: data.file || 'video.mp4',
              url: data.path || ''
            });
            break;
          case 'at':
            text += `[@${data.qq}]`;
            break;
        }
      }
    }

    return { text, images, files };
  }

  private parseNoticeEvent(event: any): UnifiedMessage | null {
    const noticeType = event.notice_type;
    const senderId = event.user_id?.toString();

    if (noticeType === 'offline_file') {
      if (!senderId || !this.isAllowed(senderId, 'private')) {
        return null;
      }

      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        channel: 'onebot',
        direction: 'inbound',
        chatId: senderId,
        chatType: 'private',
        senderId,
        text: `[文件: ${event.file?.name || 'file'}]`,
        images: [],
        files: [{
          id: randomUUID().slice(0, 8),
          type: 'file',
          name: event.file?.name || 'file',
          url: event.file?.url || ''
        }],
        timestamp: event.time ? new Date(event.time * 1000) : new Date(),
        raw: event
      };
    }

    if (noticeType === 'group_upload') {
      const groupId = event.group_id?.toString();

      if (!senderId || !groupId || !this.isAllowed(senderId, 'group')) {
        return null;
      }

      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        channel: 'onebot',
        direction: 'inbound',
        chatId: groupId,
        chatType: 'group',
        senderId,
        text: `[文件: ${event.file?.name || 'file'}]`,
        images: [],
        files: [{
          id: randomUUID().slice(0, 8),
          type: 'file',
          name: event.file?.name || 'file',
          url: '' // 需要通过 API 获取下载链接
        }],
        timestamp: event.time ? new Date(event.time * 1000) : new Date(),
        raw: event
      };
    }

    return null;
  }

  private shouldIgnoreMessage(event: any): boolean {
    const senderId = event.user_id?.toString();

    // 忽略自己的消息
    if (senderId && this.selfId && senderId === this.selfId) {
      return true;
    }

    // 忽略通知类型消息
    if (event.sub_type === 'notice') {
      return true;
    }

    return false;
  }

  private async createImageSegment(image: ImageAttachment): Promise<any | null> {
    // 如果 URL 是本地路径，转换为 base64
    if (image.url && !image.url.startsWith('http')) {
      try {
        const buffer = await fs.promises.readFile(image.url);
        const base64 = buffer.toString('base64');
        return { type: 'image', data: { file: `base64://${base64}` } };
      } catch {
        return null;
      }
    }

    // 远程 URL 直接使用
    if (image.url) {
      return { type: 'image', data: { file: image.url } };
    }

    return null;
  }

  private isAllowed(senderId: string, messageType: 'private' | 'group'): boolean {
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

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.config.token) {
        headers.Authorization = `Bearer ${this.config.token}`;
      }

      this.ws = new WebSocket(this.config.wsUrl, { headers });

      this.ws.on('open', async () => {
        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        try {
          const res = await this.sendAction('get_login_info', {});
          this.selfId = res.data?.user_id?.toString();
        } catch {
          // 忽略错误
        }

        this.flushPendingActions();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const payload = JSON.parse(data.toString());
          this.handleOneBotEvent(payload);
        } catch {
          // 忽略解析错误
        }
      });

      this.ws.on('close', () => {
        this.clearHeartbeat();
        this.handleDisconnect();
      });

      this.ws.on('error', (error) => {
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
      DEFAULT_RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      DEFAULT_RECONNECT_MAX_DELAY
    );

    if (DEFAULT_MAX_RECONNECT_ATTEMPTS > 0 && this.reconnectAttempts > DEFAULT_MAX_RECONNECT_ATTEMPTS) {
      this.running = false;
      return;
    }

    setTimeout(() => {
      this.connectWebSocket().catch(() => {
        // 重连失败会继续触发断开处理
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setTimeout(() => {
      void this.sendHeartbeat();
      this.heartbeatInterval = setInterval(() => {
        void this.sendHeartbeat();
      }, DEFAULT_HEARTBEAT_INTERVAL);
    }, DEFAULT_HEARTBEAT_INTERVAL);
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
      // 忽略心跳错误
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

      const id = randomUUID();
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
        } catch {
          // 忽略解析错误
        }
      };

      this.ws.on('message', handler);

      try {
        this.ws.send(message);
      } catch {
        cleanup();
        reject(new Error('WebSocket send failed'));
        return;
      }

      timeoutHandle = setTimeout(() => {
        settle(reject, new Error('Action timeout'));
      }, WEBSOCKET_ACTION_TIMEOUT);
    });
  }

  private handleOneBotEvent(payload: any): void {
    const postType = payload.post_type;

    if (postType === 'message' || postType === 'notice') {
      // 使用基类提供的 context 属性
      void (this as any).context?.reportIncoming(payload);
    }
  }

  private async uploadFile(chatId: number, isGroup: boolean, filePath: string): Promise<void> {
    const normalizedPath = filePath.startsWith('file://') ? filePath.substring(7) : filePath;

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
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;
    const totalChunks = Math.max(1, Math.ceil(fileSize / this.FILE_UPLOAD_CHUNK_SIZE));
    const expectedSha256 = await this.calculateFileSha256(filePath);
    const streamId = randomUUID();

    const fd = await fs.promises.open(filePath, 'r');
    try {
      let chunkIndex = 0;
      let position = 0;

      while (position < fileSize || (fileSize === 0 && chunkIndex === 0)) {
        const length = fileSize === 0
          ? 0
          : Math.min(this.FILE_UPLOAD_CHUNK_SIZE, fileSize - position);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = fileSize === 0 ? { bytesRead: 0 } : await fd.read(buffer, 0, length, position);

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
      await fd.close();
    }

    const response = await this.sendAction('upload_file_stream', {
      stream_id: streamId,
      is_complete: true
    });
    const result = response?.data;

    if (result?.status !== 'file_complete' || typeof result.file_path !== 'string' || result.file_path.length === 0) {
      throw new Error(`Stream upload incomplete: ${JSON.stringify(result)}`);
    }

    return result.file_path;
  }

  private async calculateFileSha256(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const fd = await fs.promises.open(filePath, 'r');

    try {
      const buffer = Buffer.alloc(this.FILE_UPLOAD_CHUNK_SIZE);
      let bytesRead = 0;
      let position = 0;

      do {
        const result = await fd.read(buffer, 0, buffer.length, position);
        bytesRead = result.bytesRead;
        if (bytesRead > 0) {
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
      } while (bytesRead > 0);
    } finally {
      await fd.close();
    }

    return hash.digest('hex');
  }
}

// 导出适配器实例
export default new OneBotAdapter(defaultChannelConfig as OneBotConfig);
