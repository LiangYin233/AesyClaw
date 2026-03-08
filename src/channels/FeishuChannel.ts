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

/**
 * Feishu Channel Configuration
 *
 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
 */
export interface FeishuConfig {
  /** Application ID from Feishu Open Platform */
  appId: string;
  /** Application Secret from Feishu Open Platform */
  appSecret: string;
  /** Verification Token for webhook event validation */
  verificationToken: string;
  /** Optional encryption key for encrypted events */
  encryptKey?: string;
  /** Port for webhook server to listen on */
  webhookPort: number;
  /** Path for webhook endpoint (e.g., "/feishu/webhook") */
  webhookPath: string;
  /** Whitelist of user open_ids allowed to send private messages (empty = allow all) */
  friendAllowFrom?: string[];
  /** Whitelist of chat_ids allowed to send group messages (empty = allow all) */
  groupAllowFrom?: string[];
  /** API base URL (default: https://open.feishu.cn for China, https://open.larksuite.com for international) */
  apiBase?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

/**
 * Feishu Channel Adapter
 *
 * Implements message sending and receiving for Feishu (Lark) platform.
 *
 * Features:
 * - Webhook server for receiving events
 * - Automatic token refresh (tenant_access_token)
 * - Message type support: text, image, file, post (rich text)
 * - File download and upload
 * - Permission whitelist control
 *
 * Rate Limits:
 * - 5 QPS per user for private messages
 * - 5 QPS per group (shared among all bots in the group)
 * - 1000 requests/minute, 50 requests/second (API level)
 *
 * Message Size Limits:
 * - Text messages: max 150 KB
 * - Card/Rich text messages: max 30 KB
 *
 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
 */
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

  /**
   * Refresh tenant_access_token
   *
   * Token expires in 2 hours. We refresh it 5 minutes before expiration.
   *
   * @see https://open.feishu.cn/document/ukTMukTMukTM/ukDNz4SO0MjL5QzM/auth-v3/auth/tenant_access_token_internal
   */
  private async refreshToken(): Promise<void> {
    const url = `${this.apiBase}/open-apis/auth/v3/tenant_access_token/internal`;

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

  /**
   * Handle incoming message event from Feishu
   *
   * Process flow:
   * 1. Extract sender and chat information
   * 2. Check permissions (whitelist)
   * 3. Parse message content based on message type
   * 4. Download files if present
   * 5. Publish to EventBus for further processing
   */
  private async handleMessageEvent(event: any): Promise<void> {
    const sender = event.sender?.sender_id?.open_id;
    const message = event.message;
    const messageType = message.chat_type === 'p2p' ? 'private' : 'group';

    // For private messages, use sender's open_id; for group messages, use chat_id
    const chatId = messageType === 'private' ? sender : message.chat_id;

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

  /**
   * Parse message content based on message type
   *
   * Supported types:
   * - text: Plain text
   * - image: Image with image_key
   * - file: File with file_key and file_name
   * - post: Rich text (extracts plain text)
   *
   * @returns Parsed content with optional media URLs and file information
   */
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

  /**
   * Send a message to Feishu
   *
   * Supported message types:
   * - text: Plain text messages
   * - image: Image messages (requires upload first)
   * - file: File messages (requires upload first)
   * - post: Rich text messages
   *
   * Rate limits:
   * - 5 QPS per user (private messages)
   * - 5 QPS per group (shared among all bots)
   *
   * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
   */
  async send(msg: OutboundMessage): Promise<void> {
    if (!this.validateMessage(msg)) {
      return;
    }

    try {
      const token = await this.getValidToken();
      const receiveIdType = msg.messageType === 'group' ? 'chat_id' : 'open_id';

      // 格式化消息
      const { msgType, content } = await this.formatOutboundMessage(msg);

      this.log.debug(`Formatting message - msgType: ${msgType}, content object:`, content);
      this.log.debug(`Original message content: "${msg.content}"`);

      // Generate UUID for request deduplication (optional but recommended)
      const uuid = this.generateUUID();

      const requestBody = {
        receive_id: msg.chatId,
        msg_type: msgType,
        content: JSON.stringify(content),  // Feishu expects content as a JSON string
        uuid: uuid  // For request deduplication within 1 hour
      };

      this.log.debug(`Sending message: ${JSON.stringify(requestBody)}`);

      const url = `${this.apiBase}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
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

  /**
   * Format outbound message for Feishu API
   *
   * Handles different message types:
   * - Media (images): Upload first, then send with image_key
   * - Text: Send directly with text content
   *
   * Note: If image upload fails, falls back to text message
   */
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
        // If image upload fails and there's no text content, use a placeholder
        if (!msg.content || msg.content.trim() === '') {
          return {
            msgType: 'text',
            content: { text: '[图片上传失败]' }
          };
        }
      }
    }

    // 默认发送文本，但确保内容不为空
    const textContent = msg.content && msg.content.trim() !== '' ? msg.content : '[空消息]';
    return {
      msgType: 'text',
      content: { text: textContent }
    };
  }

  /**
   * Upload image to Feishu
   *
   * @param imagePath Local path to the image file
   * @returns image_key for sending image messages
   *
   * Common errors:
   * - 230017: Bot is not the owner of the resource
   * - 230025: File size exceeds limit
   *
   * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/image/create
   */
  private async uploadImage(imagePath: string): Promise<string> {
    const token = await this.getValidToken();

    // 读取文件
    const buffer = fs.readFileSync(imagePath);

    // 创建 FormData
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', buffer, {
      filename: basename(imagePath),
      contentType: this.getImageContentType(imagePath)
    });

    // 使用 form-data 的 submit 方法而不是 fetch
    return new Promise((resolve, reject) => {
      form.submit(
        {
          protocol: this.apiBase.startsWith('https') ? 'https:' : 'http:',
          host: new URL(this.apiBase).host,
          path: '/open-apis/im/v1/images',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        },
        (err, res) => {
          if (err) {
            reject(new Error(`Failed to upload image: ${err.message}`));
            return;
          }

          let data = '';
          res.on('data', chunk => {
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
            } catch (parseErr: any) {
              reject(new Error(`Failed to parse response: ${parseErr.message}`));
            }
          });

          res.on('error', (resErr) => {
            reject(new Error(`Response error: ${resErr.message}`));
          });
        }
      );
    });
  }

  /**
   * Get content type for image file based on extension
   */
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

  /**
   * Generate a UUID for request deduplication
   *
   * Feishu uses UUID to deduplicate requests within 1 hour.
   * Same UUID will only send one message successfully within 1 hour.
   */
  private generateUUID(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}
