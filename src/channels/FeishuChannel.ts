import express from 'express';
import http from 'http';
import fs from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { BaseChannel } from './BaseChannel.js';
import { ChannelManager, type ChannelPlugin } from './ChannelManager.js';
import type { OutboundMessage, InboundFile } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey?: string;
  webhookPort: number;
  webhookPath: string;
  friendAllowFrom?: string[];
  groupAllowFrom?: string[];
  apiBase?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

export class FeishuChannel extends BaseChannel {
  readonly name = 'feishu';
  private webhookServer?: http.Server;
  private app: express.Application;
  private tokenCache?: TokenCache;
  private tokenRefreshTimer?: NodeJS.Timeout;
  protected log = logger.child({ prefix: 'Feishu' });
  private apiBase: string;

  constructor(config: FeishuConfig, eventBus: EventBus, workspace?: string) {
    super(config, eventBus, workspace);
    this.app = express();
    this.apiBase = config.apiBase || 'https://open.feishu.cn';
  }

  static register(): void {
    const plugin: ChannelPlugin = {
      name: 'feishu',
      create: (config, eventBus, workspace) =>
        new FeishuChannel(config, eventBus, workspace)
    };
    ChannelManager.registerPlugin(plugin);
  }

  async start(): Promise<void> {
    this.setupWebhookRoutes();
    await this.startWebhookServer();
    await this.refreshToken();
    this.startTokenRefreshTimer();
    this.running = true;
    this.log.info('Feishu channel started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = undefined;
    }
    if (this.webhookServer) {
      await new Promise<void>(resolve => {
        this.webhookServer!.close(() => resolve());
      });
      this.webhookServer = undefined;
    }
    this.log.info('Feishu channel stopped');
  }

  private setupWebhookRoutes(): void {
    this.app.use(express.json());

    this.app.post(this.config.webhookPath, (req, res) => {
      const event = req.body;

      // URL 验证（飞书首次配置时）
      if (event.type === 'url_verification') {
        this.log.info('Received URL verification challenge');
        return res.json({ challenge: event.challenge });
      }

      // Token 验证
      if (event.header?.token !== this.config.verificationToken) {
        this.log.warn('Invalid verification token');
        return res.status(401).json({ error: 'Invalid token' });
      }

      // 异步处理事件
      this.handleFeishuEvent(event).catch(err => {
        this.log.error('Event handling failed:', err);
      });

      // 立即返回成功
      res.json({ success: true });
    });
  }

  private async startWebhookServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.webhookServer = this.app.listen(this.config.webhookPort, () => {
        this.log.info(`Webhook server listening on port ${this.config.webhookPort}`);
        resolve();
      });
      this.webhookServer.on('error', reject);
    });
  }

  private async refreshToken(): Promise<void> {
    const url = `${this.apiBase}/open-apis/auth/v3/tenant_access_token/internal`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret
        })
      });

      const result: any = await response.json();
      if (result.code !== 0) {
        throw new Error(`Failed to get token: ${result.msg}`);
      }

      // 提前 5 分钟刷新
      this.tokenCache = {
        token: result.tenant_access_token,
        expiresAt: Date.now() + (result.expire - 300) * 1000
      };

      this.log.info('Token refreshed successfully');
    } catch (error) {
      this.log.error('Token refresh failed:', error);
      throw error;
    }
  }

  private async getValidToken(): Promise<string> {
    if (!this.tokenCache || Date.now() >= this.tokenCache.expiresAt) {
      await this.refreshToken();
    }
    return this.tokenCache!.token;
  }

  private startTokenRefreshTimer(): void {
    // 每 1.5 小时刷新一次
    this.tokenRefreshTimer = setInterval(() => {
      this.refreshToken().catch(err => {
        this.log.error('Scheduled token refresh failed:', err);
      });
    }, 90 * 60 * 1000);
  }

  private async handleFeishuEvent(payload: any): Promise<void> {
    const eventType = payload.header?.event_type;

    if (eventType === 'im.message.receive_v1') {
      await this.handleMessageEvent(payload.event);
    } else {
      this.log.debug(`Unhandled event type: ${eventType}`);
    }
  }

  private async handleMessageEvent(event: any): Promise<void> {
    const sender = event.sender?.sender_id?.open_id;
    const message = event.message;
    const chatId = message.chat_id;
    const messageType = message.chat_type === 'p2p' ? 'private' : 'group';

    if (!sender || !chatId) {
      this.log.debug('Missing sender or chatId');
      return;
    }

    // 权限检查
    if (!this.isAllowed(sender, messageType)) {
      this.log.debug(`Message from ${sender} not allowed`);
      return;
    }

    // 解析消息内容
    const { content, media, files } = await this.parseMessageContent(
      message.message_type,
      message.content,
      message.message_id
    );

    // 下载文件
    let downloadedFiles: InboundFile[] | undefined;
    if (files && files.length > 0) {
      downloadedFiles = await this.downloadFiles(files);
    }

    // 发布到 EventBus
    this.handleMessage(
      sender,
      chatId,
      content,
      event,
      message.message_id,
      messageType,
      media,
      downloadedFiles
    );
  }

  private async parseMessageContent(
    messageType: string,
    content: string,
    messageId: string
  ): Promise<{ content: string; media?: string[]; files?: InboundFile[] }> {
    try {
      const parsed = JSON.parse(content);

      switch (messageType) {
        case 'text':
          return { content: parsed.text || '' };

        case 'image': {
          const imageKey = parsed.image_key;
          if (!imageKey) {
            return { content: '[图片]' };
          }
          const imageUrl = await this.getResourceUrl(imageKey, 'image');
          return {
            content: '[图片]',
            media: [imageUrl]
          };
        }

        case 'file': {
          const fileKey = parsed.file_key;
          const fileName = parsed.file_name || 'file';
          if (!fileKey) {
            return { content: `[文件: ${fileName}]` };
          }
          const fileUrl = await this.getResourceUrl(fileKey, 'file');
          return {
            content: `[文件: ${fileName}]`,
            files: [{ name: fileName, url: fileUrl }]
          };
        }

        case 'post':
          // 富文本，提取纯文本内容
          return { content: this.extractPostText(parsed) };

        default:
          return { content: `[不支持的消息类型: ${messageType}]` };
      }
    } catch (error) {
      this.log.warn(`Failed to parse message content:`, error);
      return { content: content };
    }
  }

  private extractPostText(post: any): string {
    try {
      const content = post.content;
      if (!content) return '[富文本]';

      let text = '';
      for (const item of content) {
        if (Array.isArray(item)) {
          for (const element of item) {
            if (element.tag === 'text') {
              text += element.text || '';
            } else if (element.tag === 'a') {
              text += element.text || element.href || '';
            }
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

    return `${this.apiBase}${endpoint}?access_token=${token}`;
  }

  private async downloadFiles(files: InboundFile[]): Promise<InboundFile[]> {
    const downloadDir = join(this.workspace, 'downloads');
    await mkdir(downloadDir, { recursive: true });

    const downloaded: InboundFile[] = [];

    for (const file of files) {
      try {
        const token = await this.getValidToken();
        const response = await fetch(file.url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
          this.log.warn(`Failed to download ${file.name}: HTTP ${response.status}`);
          downloaded.push(file);
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const localPath = join(downloadDir, basename(file.name));
        await writeFile(localPath, buffer);

        downloaded.push({ ...file, localPath });
        this.log.info(`File downloaded: ${file.name} -> ${localPath}`);
      } catch (err) {
        this.log.warn(`Failed to download ${file.name}:`, err);
        downloaded.push(file);
      }
    }

    return downloaded;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.validateMessage(msg)) {
      return;
    }

    try {
      const token = await this.getValidToken();
      const receiveIdType = msg.messageType === 'group' ? 'chat_id' : 'open_id';

      // 格式化消息
      const { msgType, content } = await this.formatOutboundMessage(msg);

      const requestBody = {
        receive_id: msg.chatId,
        receive_id_type: receiveIdType,
        msg_type: msgType,
        content: JSON.stringify(content)  // Feishu expects content as a JSON string
      };

      this.log.debug(`Sending message: ${JSON.stringify(requestBody)}`);

      const url = `${this.apiBase}/open-apis/im/v1/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const result: any = await response.json();
      if (result.code !== 0) {
        this.log.error(`Feishu API error response: ${JSON.stringify(result)}`);
        throw new Error(`Feishu API error: ${result.msg}`);
      }

      metrics.record('channel.message_sent', 1, 'count', {
        channel: this.name,
        messageType: msg.messageType || 'private',
        status: 'success'
      });
      this.log.info(`Message sent to ${msg.chatId}`);
    } catch (error) {
      metrics.record('channel.message_sent', 1, 'count', {
        channel: this.name,
        messageType: msg.messageType || 'private',
        status: 'error'
      });
      this.log.error('Failed to send message:', error);
      throw error;
    }
  }

  private async formatOutboundMessage(msg: OutboundMessage): Promise<{ msgType: string; content: any }> {
    // 处理媒体文件
    if (msg.media && msg.media.length > 0) {
      try {
        const imageKey = await this.uploadImage(msg.media[0]);
        return {
          msgType: 'image',
          content: { image_key: imageKey }
        };
      } catch (error) {
        this.log.warn('Failed to upload image, falling back to text:', error);
      }
    }

    // 默认发送文本
    return {
      msgType: 'text',
      content: { text: msg.content }
    };
  }

  private async uploadImage(imagePath: string): Promise<string> {
    const token = await this.getValidToken();

    // 读取文件
    const buffer = fs.readFileSync(imagePath);

    // 创建 FormData
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', buffer, { filename: basename(imagePath) });

    const response = await fetch(
      `${this.apiBase}/open-apis/im/v1/images`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          ...form.getHeaders()
        },
        body: form as any
      }
    );

    const result: any = await response.json();
    if (result.code !== 0) {
      throw new Error(`Failed to upload image: ${result.msg}`);
    }

    return result.data.image_key;
  }
}
