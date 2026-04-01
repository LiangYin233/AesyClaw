import express from 'express';
import http from 'http';
import fs from 'fs';
import { basename } from 'path';
import { randomUUID } from 'crypto';
import { BaseChannelAdapter } from '../../src/features/extension/channel/adapter/BaseChannelAdapter.js';
import type { SendResult } from '../../src/features/extension/channel/protocol/adapter-interface.js';
import type { UnifiedMessage } from '../../src/features/extension/channel/protocol/unified-message.js';
import type { ImageAttachment, FileAttachment } from '../../src/features/extension/channel/protocol/attachment.js';
import { logger } from '../../src/platform/observability/index.ts';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken: string;
  webhookPort: number;
  webhookPath: string;
  friendAllowFrom?: string[];
  groupAllowFrom?: string[];
}

export const defaultChannelConfig: FeishuConfig = {
  appId: '',
  appSecret: '',
  verificationToken: '',
  webhookPort: 3100,
  webhookPath: '/feishu/webhook',
  friendAllowFrom: [],
  groupAllowFrom: []
};

interface TokenCache {
  token: string;
  expiresAt: number;
}

class FeishuAdapter extends BaseChannelAdapter {
  private static readonly FEISHU_API_BASE = 'https://open.feishu.cn';
  readonly name = 'feishu';
  private webhookServer?: http.Server;
  private app: any;
  private tokenCache?: TokenCache;
  private tokenRefreshTimer?: NodeJS.Timeout;
  private running = false;
  private log = logger.child('Feishu');

  constructor(private config: FeishuConfig) {
    super();
    this.app = express();
  }

  protected async onStart(): Promise<void> {
    this.setupWebhookRoutes();
    await this.startWebhookServer();
    await this.refreshToken();
    this.startTokenRefreshTimer();
    this.running = true;
  }

  protected async onStop(): Promise<void> {
    this.running = false;
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = undefined;
    }
    if (this.webhookServer) {
      await new Promise<void>((resolve) => {
        this.webhookServer?.close(() => resolve());
      });
      this.webhookServer = undefined;
    }
  }

  protected async parsePlatformEvent(rawEvent: unknown): Promise<UnifiedMessage | null> {
    const event = rawEvent as any;
    const sender = event?.sender?.sender_id?.open_id;
    const message = event?.message;
    const messageType = message?.chat_type === 'p2p' ? 'private' : 'group';
    const chatId = messageType === 'private' ? sender : message?.chat_id;

    if (!sender || !chatId || !this.isAllowed(sender, messageType)) {
      return null;
    }

    const { text, images, files } = await this.parseMessageContent(message?.message_type, message?.content);

    return {
      id: message?.message_id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      channel: 'feishu',
      direction: 'inbound',
      chatId,
      chatType: messageType,
      senderId: sender,
      senderName: event.sender?.sender_id?.user_id || event.sender?.sender_id?.union_id,
      text,
      images,
      files,
      timestamp: message?.create_time ? new Date(Number(message.create_time)) : new Date(),
      raw: event
    };
  }

  protected async sendToPlatform(message: UnifiedMessage): Promise<SendResult> {
    const token = await this.getValidToken();
    const receiveIdType = message.chatType === 'group' ? 'chat_id' : 'open_id';
    const url = `${FeishuAdapter.FEISHU_API_BASE}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
    
    const parts = await this.formatOutboundMessages(message);
    let platformMessageId: string | undefined;

    for (const part of parts) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            receive_id: message.chatId,
            msg_type: part.msgType,
            content: JSON.stringify(part.content),
            uuid: randomUUID()
          })
        });

        const result: any = await response.json();
        if (result.code !== 0) {
          throw new Error(`Feishu API error (${result.code}): ${result.msg}`);
        }
        platformMessageId = result.data?.message_id || platformMessageId;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return { success: true, messageId: platformMessageId };
  }

  private setupWebhookRoutes(): void {
    this.app.use(express.json());

    this.app.post(this.config.webhookPath, (req, res) => {
      const payload = req.body;

      if (payload.type === 'url_verification') {
        return res.json({ challenge: payload.challenge });
      }

      if (payload.header?.token !== this.config.verificationToken) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      void this.handleFeishuEvent(payload).catch(() => {
        // 忽略错误
      });

      return res.json({ success: true });
    });
  }

  private async startWebhookServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.webhookServer = this.app.listen(this.config.webhookPort, () => {
        resolve();
      });
      if (this.webhookServer) {
        this.webhookServer.on('error', reject);
      }
    });
  }

  private async refreshToken(): Promise<void> {
    const url = `${FeishuAdapter.FEISHU_API_BASE}/open-apis/auth/v3/tenant_access_token/internal`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret
      })
    });

    const result: any = await response.json();
    if (result.code !== 0) {
      throw new Error(`Failed to get token: ${result.msg}`);
    }

    this.tokenCache = {
      token: result.tenant_access_token,
      expiresAt: Date.now() + (result.expire - 300) * 1000
    };
  }

  private async getValidToken(): Promise<string> {
    if (!this.tokenCache || Date.now() >= this.tokenCache.expiresAt) {
      await this.refreshToken();
    }

    if (!this.tokenCache) {
      throw new Error('Feishu token unavailable after refresh');
    }

    return this.tokenCache.token;
  }

  private startTokenRefreshTimer(): void {
    this.tokenRefreshTimer = setInterval(() => {
      void this.refreshToken().catch(() => {
        // 忽略错误
      });
    }, 90 * 60 * 1000);
  }

  private async handleFeishuEvent(payload: any): Promise<void> {
    const eventType = payload.header?.event_type;
    if (eventType !== 'im.message.receive_v1') {
      return;
    }

    void (this as any).context?.reportIncoming(payload.event);
  }

  private isAllowed(senderId: string, messageType: 'private' | 'group'): boolean {
    if (messageType === 'group') {
      const list = this.config.groupAllowFrom;
      return !list || list.length === 0 ? true : list.includes(senderId);
    }

    const list = this.config.friendAllowFrom;
    return !list || list.length === 0 ? true : list.includes(senderId);
  }

  private async parseMessageContent(messageType: string, content: string): Promise<{ text: string; images: ImageAttachment[]; files: FileAttachment[] }> {
    const images: ImageAttachment[] = [];
    const files: FileAttachment[] = [];

    if (!content) {
      return { text: '', images, files };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { text: content, images, files };
    }

    switch (messageType) {
      case 'text':
        return { text: parsed.text || '', images, files };
      case 'post':
        return { text: this.extractPostText(parsed), images, files };
      case 'image':
        if (parsed.image_key) {
          images.push({
            id: randomUUID().slice(0, 8),
            type: 'image',
            name: parsed.file_name || `${parsed.image_key}.png`,
            url: await this.getResourceUrl(parsed.image_key, 'image')
          });
        }
        return { text: '', images, files };
      case 'audio':
        if (parsed.file_key) {
          files.push({
            id: randomUUID().slice(0, 8),
            type: 'audio',
            name: parsed.file_name || 'voice.amr',
            url: await this.getResourceUrl(parsed.file_key, 'file')
          });
        }
        return { text: '', images, files };
      case 'media':
        if (parsed.file_key) {
          files.push({
            id: randomUUID().slice(0, 8),
            type: 'video',
            name: parsed.file_name || 'video.mp4',
            url: await this.getResourceUrl(parsed.file_key, 'file')
          });
        }
        return { text: '', images, files };
      case 'file':
        if (parsed.file_key) {
          files.push({
            id: randomUUID().slice(0, 8),
            type: 'file',
            name: parsed.file_name || 'file',
            url: await this.getResourceUrl(parsed.file_key, 'file')
          });
        }
        return { text: '', images, files };
      default:
        return { text: `[${messageType}]`, images, files };
    }
  }

  private extractPostText(post: any): string {
    try {
      const content = post.content;
      if (!content) {
        return '[富文本]';
      }

      let text = '';
      for (const item of content) {
        if (!Array.isArray(item)) {
          continue;
        }
        for (const element of item) {
          if (element.tag === 'text') {
            text += element.text || '';
          } else if (element.tag === 'a') {
            text += element.text || element.href || '';
          }
        }
      }
      return text.trim() || '[富文本]';
    } catch {
      return '[富文本]';
    }
  }

  private async getResourceUrl(fileKey: string, type: 'image' | 'file'): Promise<string> {
    const token = await this.getValidToken();
    const endpoint = type === 'image'
      ? `/open-apis/im/v1/images/${fileKey}`
      : `/open-apis/im/v1/files/${fileKey}`;

    return `${FeishuAdapter.FEISHU_API_BASE}${endpoint}?access_token=${token}`;
  }

  private async formatOutboundMessages(message: UnifiedMessage): Promise<Array<{ msgType: string; content: Record<string, string> }>> {
    const parts: Array<{ msgType: string; content: Record<string, string> }> = [];
    let textBuffer = '';

    const flushText = () => {
      const text = textBuffer.trim();
      if (text) {
        parts.push({ msgType: 'text', content: { text } });
      }
      textBuffer = '';
    };

    // 处理文本
    if (message.text) {
      textBuffer += message.text;
    }

    flushText();

    // 处理图片
    for (const image of message.images) {
      try {
        const imageKey = await this.uploadImage(image.url);
        parts.push({ msgType: 'image', content: { image_key: imageKey } });
      } catch (error) {
        this.log.error('Failed to upload image: ' + (error instanceof Error ? error.message : String(error)));
      }
    }

    // 处理文件
    for (const file of message.files) {
      try {
        const fileKey = await this.uploadFile(file.url);
        parts.push({ msgType: 'file', content: { file_key: fileKey } });
      } catch (error) {
        this.log.error('Failed to upload file: ' + (error instanceof Error ? error.message : String(error)));
      }
    }

    return parts.length > 0 ? parts : [{ msgType: 'text', content: { text: '[空消息]' } }];
  }

  private async uploadImage(imageUrl: string): Promise<string> {
    const token = await this.getValidToken();
    
    // 如果 URL 是本地路径，读取文件
    let buffer: Buffer;
    if (!imageUrl.startsWith('http')) {
      buffer = fs.readFileSync(imageUrl);
    } else {
      const response = await fetch(imageUrl);
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', buffer, {
      filename: basename(imageUrl),
      contentType: this.getImageContentType(imageUrl)
    });

    return new Promise((resolve, reject) => {
      form.submit(
        {
          protocol: 'https:',
          host: new URL(FeishuAdapter.FEISHU_API_BASE).host,
          path: '/open-apis/im/v1/images',
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        },
        (err, res) => {
          if (err) {
            reject(new Error(`Failed to upload image: ${err.message}`));
            return;
          }

          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                reject(new Error(`Failed to upload image: HTTP ${res.statusCode} - ${data}`));
                return;
              }
              const result = JSON.parse(data);
              if (result.code !== 0) {
                reject(new Error(`Failed to upload image: ${result.msg || result.message || 'Unknown error'}`));
                return;
              }
              resolve(result.data.image_key);
            } catch (parseError: any) {
              reject(new Error(`Failed to parse response: ${parseError.message}`));
            }
          });
        }
      );
    });
  }

  private async uploadFile(fileUrl: string): Promise<string> {
    const token = await this.getValidToken();
    
    // 如果 URL 是本地路径，读取文件
    let buffer: Buffer;
    if (!fileUrl.startsWith('http')) {
      buffer = fs.readFileSync(fileUrl);
    } else {
      const response = await fetch(fileUrl);
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file_type', 'stream');
    form.append('file_name', basename(fileUrl));
    form.append('file', buffer, {
      filename: basename(fileUrl),
      contentType: 'application/octet-stream'
    });

    return new Promise((resolve, reject) => {
      form.submit(
        {
          protocol: 'https:',
          host: new URL(FeishuAdapter.FEISHU_API_BASE).host,
          path: '/open-apis/im/v1/files',
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        },
        (err, res) => {
          if (err) {
            reject(new Error(`Failed to upload file: ${err.message}`));
            return;
          }

          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                reject(new Error(`Failed to upload file: HTTP ${res.statusCode} - ${data}`));
                return;
              }
              const result = JSON.parse(data);
              if (result.code !== 0) {
                reject(new Error(`Failed to upload file: ${result.msg || result.message || 'Unknown error'}`));
                return;
              }
              resolve(result.data.file_key);
            } catch (parseError: any) {
              reject(new Error(`Failed to parse response: ${parseError.message}`));
            }
          });
        }
      );
    });
  }

  private getImageContentType(imagePath: string): string {
    const ext = imagePath.toLowerCase().split('.').pop();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'bmp':
        return 'image/bmp';
      case 'webp':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
  }
}

// 导出适配器实例
export default new FeishuAdapter(defaultChannelConfig);
