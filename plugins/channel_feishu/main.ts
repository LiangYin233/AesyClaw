import express from 'express';
import http from 'http';
import fs from 'fs';
import { basename } from 'path';
import type { EventBus } from '../../src/bus/EventBus.js';
import { BaseChannel } from '../../src/channels/BaseChannel.js';
import { MessageHandlers } from '../../src/channels/MessageParser.js';
import type { ChannelPluginDefinition } from '../../src/channels/ChannelManager.js';
import { logger } from '../../src/logger/index.js';
import { metrics } from '../../src/logger/Metrics.js';
import type { InboundFile, OutboundMessage } from '../../src/types.js';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken: string;
  webhookPort: number;
  webhookPath: string;
  friendAllowFrom?: string[];
  groupAllowFrom?: string[];
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

class FeishuChannel extends BaseChannel {
  private static readonly FEISHU_API_BASE = 'https://open.feishu.cn';
  readonly name = 'feishu';
  private webhookServer?: http.Server;
  private app: express.Application;
  private tokenCache?: TokenCache;
  private tokenRefreshTimer?: NodeJS.Timeout;
  private currentMessage?: { type: string; content: string };
  protected log = logger.child({ prefix: 'Feishu' });

  constructor(config: FeishuConfig, eventBus: EventBus, workspace?: string) {
    super(config, eventBus, workspace);
    this.app = express();
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
      await new Promise<void>((resolve) => {
        this.webhookServer?.close(() => resolve());
      });
      this.webhookServer = undefined;
    }
    this.log.info('Feishu channel stopped');
  }

  private setupWebhookRoutes(): void {
    this.app.use(express.json());

    this.app.post(this.config.webhookPath, (req, res) => {
      const event = req.body;

      if (event.type === 'url_verification') {
        this.log.info('Received URL verification challenge');
        return res.json({ challenge: event.challenge });
      }

      if (event.header?.token !== this.config.verificationToken) {
        this.log.warn('Invalid verification token');
        return res.status(401).json({ error: 'Invalid token' });
      }

      void this.handleFeishuEvent(event).catch((err) => {
        this.log.error('Event handling failed:', err);
      });

      return res.json({ success: true });
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
    const url = `${FeishuChannel.FEISHU_API_BASE}/open-apis/auth/v3/tenant_access_token/internal`;

    try {
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
    return this.tokenCache.token;
  }

  private startTokenRefreshTimer(): void {
    this.tokenRefreshTimer = setInterval(() => {
      void this.refreshToken().catch((err) => {
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
    const messageType = message.chat_type === 'p2p' ? 'private' : 'group';
    const chatId = messageType === 'private' ? sender : message.chat_id;

    if (!sender || !chatId) {
      this.log.debug('Missing sender or chatId');
      return;
    }

    const messageId = message.message_id;
    this.currentMessage = { type: message.message_type, content: message.content };
    await this.processInboundMessage(sender, chatId, messageType, event, messageId);
    this.currentMessage = undefined;
  }

  protected async parseMessage(_rawEvent: any): Promise<import('../../src/channels/BaseChannel.js').ParsedMessage> {
    if (!this.currentMessage) {
      return { content: '' };
    }

    return this.parseMessageContent(this.currentMessage.type, this.currentMessage.content);
  }

  protected async downloadFiles(files: InboundFile[]): Promise<InboundFile[]> {
    const token = await this.getValidToken();
    return super.downloadFiles(files, { Authorization: `Bearer ${token}` });
  }

  private async parseMessageContent(
    messageType: string,
    content: string
  ): Promise<import('../../src/channels/BaseChannel.js').ParsedMessage> {
    try {
      const parsed = JSON.parse(content);

      switch (messageType) {
        case 'text':
          return MessageHandlers.text(parsed.text || '');
        case 'image': {
          const imageKey = parsed.image_key;
          if (!imageKey) {
            return { content: '[图片]' };
          }
          const imageUrl = await this.getResourceUrl(imageKey, 'image');
          return MessageHandlers.image(imageUrl);
        }
        case 'audio': {
          const fileKey = parsed.file_key;
          const fileName = parsed.file_name || 'voice';
          if (!fileKey) {
            return { content: '[语音]' };
          }
          const fileUrl = await this.getResourceUrl(fileKey, 'file');
          return MessageHandlers.audio(fileUrl, fileName);
        }
        case 'media': {
          const fileKey = parsed.file_key;
          const fileName = parsed.file_name || 'video';
          if (!fileKey) {
            return { content: `[视频: ${fileName}]` };
          }
          const fileUrl = await this.getResourceUrl(fileKey, 'file');
          return MessageHandlers.video(fileUrl, fileName);
        }
        case 'file': {
          const fileKey = parsed.file_key;
          const fileName = parsed.file_name || 'file';
          if (!fileKey) {
            return { content: `[文件: ${fileName}]` };
          }
          const fileUrl = await this.getResourceUrl(fileKey, 'file');
          return MessageHandlers.file(fileUrl, fileName);
        }
        case 'post':
          return { content: this.extractPostText(parsed) };
        default:
          return MessageHandlers.unknown(messageType);
      }
    } catch (error) {
      this.log.warn('Failed to parse message content:', error);
      return { content };
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

    return `${FeishuChannel.FEISHU_API_BASE}${endpoint}?access_token=${token}`;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.validateMessage(msg)) {
      return;
    }

    try {
      const token = await this.getValidToken();
      const receiveIdType = msg.messageType === 'group' ? 'chat_id' : 'open_id';
      const { msgType, content } = await this.formatOutboundMessage(msg);
      const uuid = this.generateUUID();

      const requestBody = {
        receive_id: msg.chatId,
        msg_type: msgType,
        content: JSON.stringify(content),
        uuid
      };

      const url = `${FeishuChannel.FEISHU_API_BASE}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(requestBody)
      });

      const result: any = await response.json();
      if (result.code !== 0) {
        this.log.error(`Feishu API error response: ${JSON.stringify(result)}`);
        throw new Error(`Feishu API error (${result.code}): ${result.msg}`);
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
    if (msg.media && msg.media.length > 0) {
      try {
        const imageKey = await this.uploadImage(msg.media[0]);
        return { msgType: 'image', content: { image_key: imageKey } };
      } catch (error) {
        this.log.warn('Failed to upload image, falling back to text:', error);
        if (!msg.content || msg.content.trim() === '') {
          return { msgType: 'text', content: { text: '[图片上传失败]' } };
        }
      }
    }

    const textContent = msg.content && msg.content.trim() !== '' ? msg.content : '[空消息]';
    return { msgType: 'text', content: { text: textContent } };
  }

  private async uploadImage(imagePath: string): Promise<string> {
    const token = await this.getValidToken();
    const buffer = fs.readFileSync(imagePath);
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', buffer, {
      filename: basename(imagePath),
      contentType: this.getImageContentType(imagePath)
    });

    return new Promise((resolve, reject) => {
      form.submit(
        {
          protocol: FeishuChannel.FEISHU_API_BASE.startsWith('https') ? 'https:' : 'http:',
          host: new URL(FeishuChannel.FEISHU_API_BASE).host,
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

          res.on('error', (responseError) => {
            reject(new Error(`Response error: ${responseError.message}`));
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

  private generateUUID(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}

const plugin: ChannelPluginDefinition = {
  pluginName: 'channel_feishu',
  channelName: 'feishu',
  create: (config, eventBus, workspace) => new FeishuChannel(config, eventBus, workspace)
};

export default plugin;
