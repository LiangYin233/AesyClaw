import express from 'express';
import http from 'http';
import fs from 'fs';
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { ChannelPluginDefinition } from '../../src/features/channels/application/ChannelManager.ts';
import type { AdapterRuntimeContext, ChannelAdapter, ChannelSendContext } from '../../src/features/channels/domain/adapter.ts';
import { projectChannelMessage } from '../../src/features/channels/domain/projection.ts';
import type {
  AdapterInboundDraft,
  AdapterSendResult,
  ChannelCapabilityProfile,
  ChannelMessage,
  MessageSegment,
  ResourceHandle
} from '../../src/features/channels/domain/types.ts';
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

class FeishuAdapter implements ChannelAdapter {
  private static readonly FEISHU_API_BASE = 'https://open.feishu.cn';
  readonly name = 'feishu';
  private runtimeContext?: AdapterRuntimeContext;
  private webhookServer?: http.Server;
  private app: express.Application;
  private tokenCache?: TokenCache;
  private tokenRefreshTimer?: NodeJS.Timeout;
  private running = false;
  private log = logger.child('Feishu');

  constructor(private config: FeishuConfig) {
    this.app = express();
  }

  capabilities(): ChannelCapabilityProfile {
    return {
      supportsImages: true,
      supportsFiles: true,
      supportsAudio: true,
      supportsVideo: true,
      supportsQuotes: false,
      supportsMentions: false
    };
  }

  async start(ctx: AdapterRuntimeContext): Promise<void> {
    this.runtimeContext = ctx;
    this.setupWebhookRoutes();
    await this.startWebhookServer();
    await this.refreshToken();
    this.startTokenRefreshTimer();
    this.running = true;
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
  }

  isRunning(): boolean {
    return this.running;
  }

  async decodeInbound(event: any): Promise<AdapterInboundDraft | null> {
    const sender = event?.sender?.sender_id?.open_id;
    const message = event?.message;
    const messageType = message?.chat_type === 'p2p' ? 'private' : 'group';
    const chatId = messageType === 'private' ? sender : message?.chat_id;

    if (!sender || !chatId || !this.isAllowed(sender, messageType)) {
      return null;
    }

    return {
      conversation: {
        id: chatId,
        type: messageType
      },
      sender: {
        id: sender,
        displayName: event.sender?.sender_id?.user_id || event.sender?.sender_id?.union_id
      },
      timestamp: message?.create_time ? new Date(Number(message.create_time)) : new Date(),
      platformMessageId: message?.message_id,
      segments: await this.decodeMessageContent(message?.message_type, message?.content),
      metadata: {
        source: 'user'
      },
      rawEvent: event
    };
  }

  async send(message: ChannelMessage, _context: ChannelSendContext): Promise<AdapterSendResult> {
    const token = await this.getValidToken();
    const receiveIdType = message.conversation.type === 'group' ? 'chat_id' : 'open_id';
    const url = `${FeishuAdapter.FEISHU_API_BASE}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
    const parts = await this.formatOutboundMessages(message);
    let platformMessageId: string | undefined;

    for (const part of parts) {
      const requestBody = {
        receive_id: message.conversation.id,
        msg_type: part.msgType,
        content: JSON.stringify(part.content),
        uuid: randomUUID()
      };

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
        throw new Error(`Feishu API error (${result.code}): ${result.msg}`);
      }
      platformMessageId = result.data?.message_id || platformMessageId;
    }

    return { platformMessageId };
  }

  classifyError(error: unknown): { retryable: boolean; code: string; message?: string } {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = /timeout|network|ECONN|HTTP 5\d\d|temporarily/i.test(message);
    return {
      retryable,
      code: retryable ? 'transport_error' : 'send_failed',
      message
    };
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

      void this.handleFeishuEvent(payload).catch((_error) => {
      });

      return res.json({ success: true });
    });
  }

  private async startWebhookServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.webhookServer = this.app.listen(this.config.webhookPort, () => {
        resolve();
      });
      this.webhookServer.on('error', reject);
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
      void this.refreshToken().catch((_error) => {
      });
    }, 90 * 60 * 1000);
  }

  private async handleFeishuEvent(payload: any): Promise<void> {
    const eventType = payload.header?.event_type;
    if (eventType !== 'im.message.receive_v1') {
      return;
    }

    await this.runtimeContext?.ingest(payload.event);
  }

  private isAllowed(senderId: string, messageType: 'private' | 'group'): boolean {
    if (messageType === 'group') {
      const list = this.config.groupAllowFrom;
      return !list || list.length === 0 ? true : list.includes(senderId);
    }

    const list = this.config.friendAllowFrom;
    return !list || list.length === 0 ? true : list.includes(senderId);
  }

  private async decodeMessageContent(messageType: string, content: string): Promise<MessageSegment[]> {
    if (!content) {
      return [];
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      return [{ type: 'text', text: content }];
    }

    switch (messageType) {
      case 'text':
        return [{ type: 'text', text: parsed.text || '' }];
      case 'post':
        return [{ type: 'text', text: this.extractPostText(parsed) }];
      case 'image':
        return parsed.image_key ? [{
          type: 'image',
          resource: await this.buildResource('image', parsed.image_key, parsed.file_name || `${parsed.image_key}.png`)
        }] : [];
      case 'audio':
        return parsed.file_key ? [{
          type: 'audio',
          resource: await this.buildResource('audio', parsed.file_key, parsed.file_name || 'voice.amr')
        }] : [];
      case 'media':
        return parsed.file_key ? [{
          type: 'video',
          resource: await this.buildResource('video', parsed.file_key, parsed.file_name || 'video.mp4')
        }] : [];
      case 'file':
        return parsed.file_key ? [{
          type: 'file',
          resource: await this.buildResource('file', parsed.file_key, parsed.file_name || 'file')
        }] : [];
      default:
        return [{ type: 'unsupported', originalType: messageType, text: `[${messageType}]` }];
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

  private async buildResource(kind: ResourceHandle['kind'], fileKey: string, originalName: string): Promise<ResourceHandle> {
    const remoteUrl = await this.getResourceUrl(fileKey, kind === 'image' ? 'image' : 'file');
    return {
      resourceId: randomUUID().slice(0, 8),
      kind,
      originalName,
      remoteUrl,
      platformFileId: fileKey
    };
  }

  private async getResourceUrl(fileKey: string, type: 'image' | 'file'): Promise<string> {
    const token = await this.getValidToken();
    const endpoint = type === 'image'
      ? `/open-apis/im/v1/images/${fileKey}`
      : `/open-apis/im/v1/files/${fileKey}`;

    return `${FeishuAdapter.FEISHU_API_BASE}${endpoint}?access_token=${token}`;
  }

  private async formatOutboundMessages(message: ChannelMessage): Promise<Array<{ msgType: string; content: Record<string, string> }>> {
    const parts: Array<{ msgType: string; content: Record<string, string> }> = [];
    let textBuffer = '';

    const flushText = () => {
      const text = textBuffer.trim();
      if (text) {
        parts.push({ msgType: 'text', content: { text } });
      }
      textBuffer = '';
    };

    for (const segment of message.segments) {
      switch (segment.type) {
        case 'text':
          textBuffer += segment.text;
          break;
        case 'mention':
          textBuffer += segment.display ? `@${segment.display}` : `@${segment.userId}`;
          break;
        case 'quote':
          if (segment.message) {
            const quoted = projectChannelMessage(segment.message).content;
            textBuffer += quoted ? `【引用消息】\n${quoted}\n\n` : '【引用消息】\n';
          }
          break;
        case 'image': {
          flushText();
          const imagePath = this.requireLocalPath(segment.resource);
          const imageKey = await this.uploadImage(imagePath);
          parts.push({ msgType: 'image', content: { image_key: imageKey } });
          break;
        }
        case 'file':
        case 'audio':
        case 'video': {
          flushText();
          const filePath = this.requireLocalPath(segment.resource);
          const fileKey = await this.uploadFile(filePath);
          parts.push({ msgType: 'file', content: { file_key: fileKey } });
          break;
        }
        case 'unsupported':
          if (segment.text) {
            textBuffer += segment.text;
          }
          break;
        default:
          break;
      }
    }

    flushText();
    return parts.length > 0 ? parts : [{ msgType: 'text', content: { text: '[空消息]' } }];
  }

  private requireLocalPath(resource: ResourceHandle): string {
    const localPath = resource.localPath || (resource.remoteUrl?.startsWith('file://') ? resource.remoteUrl.substring(7) : undefined);
    if (!localPath || !fs.existsSync(localPath)) {
      throw new Error(`Resource local path missing: ${resource.originalName}`);
    }
    return localPath;
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
          res.on('error', (responseError) => {
            reject(new Error(`Response error: ${responseError.message}`));
          });
        }
      );
    });
  }

  private async uploadFile(filePath: string): Promise<string> {
    const token = await this.getValidToken();
    const buffer = fs.readFileSync(filePath);
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file_type', 'stream');
    form.append('file_name', basename(filePath));
    form.append('file', buffer, {
      filename: basename(filePath),
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
}

const plugin: ChannelPluginDefinition = {
  pluginName: 'channel_feishu',
  channelName: 'feishu',
  create: (config) => new FeishuAdapter(config)
};

export default plugin;
