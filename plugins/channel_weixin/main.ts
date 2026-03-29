import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChannelPluginDefinition } from '../../src/features/channels/application/ChannelManager.ts';
import type { AdapterRuntimeContext, ChannelAdapter, ChannelSendContext } from '../../src/features/channels/domain/adapter.ts';
import type {
  AdapterInboundDraft,
  AdapterSendResult,
  ChannelCapabilityProfile,
  ChannelMessage,
  MessageSegment,
  ResourceHandle
} from '../../src/features/channels/domain/types.ts';
import { logger } from '../../src/platform/observability/index.ts';
import { channelPaths } from '../../src/platform/utils/paths.ts';
import { createWeixinFacade, type WeixinFacade, type QrLoginStartResult, type QrLoginResult } from './openclaw-facade.ts';
import { MessageItemType, MessageItem } from '@tencent-weixin/openclaw-weixin/src/api/types.ts';

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const STATE_FILE = 'weixin-state.json';

interface WeixinConfig {
  baseUrl: string;
  token?: string;
  userId?: string;
  contextTokens?: Record<string, string>;
}

interface SavedState {
  token?: string;
  userId?: string;
  contextTokens?: Record<string, string>;
}

class WeixinAdapter implements ChannelAdapter {
  readonly name = 'weixin';
  private runtimeContext?: AdapterRuntimeContext;
  private config: WeixinConfig;
  private facade: WeixinFacade;
  private running = false;
  private abortController?: AbortController;
  private log = logger.child('Weixin');

  constructor(config: Partial<WeixinConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || DEFAULT_BASE_URL
    };
    this.facade = createWeixinFacade(this.log);
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
    await this.loadState();

    if (!this.config.token) {
      this.log.info('No token found, starting QR login...');
      await this.performQrLogin();
    }

    this.running = true;
    this.abortController = new AbortController();
    void this.runLongPoll();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
    await this.saveState();
  }

  isRunning(): boolean {
    return this.running;
  }

  async decodeInbound(rawEvent: any): Promise<AdapterInboundDraft | null> {
    const msg = rawEvent?.weixinMessage;
    if (!msg || !msg.from_user_id || !msg.to_user_id) {
      return null;
    }

    const senderId = msg.from_user_id;
    const conversationId = msg.to_user_id;
    const isSelf = senderId === this.config.userId;

    if (isSelf) {
      return null;
    }

    const segments: MessageSegment[] = [];
    if (msg.item_list && Array.isArray(msg.item_list)) {
      for (const item of msg.item_list) {
        const segment = this.decodeMessageItem(item);
        if (segment) {
          segments.push(segment);
        }
      }
    }

    if (segments.length === 0) {
      return null;
    }

    const contextToken = this.getOrCreateContextToken(conversationId, senderId);
    if (contextToken && !this.config.contextTokens?.[conversationId]) {
      this.config.contextTokens = this.config.contextTokens || {};
      this.config.contextTokens[conversationId] = contextToken;
      void this.saveState();
    }

    return {
      conversation: {
        id: conversationId,
        type: 'private'
      },
      sender: {
        id: senderId,
        isSelf
      },
      timestamp: msg.create_time_ms ? new Date(msg.create_time_ms) : new Date(),
      platformMessageId: String(msg.message_id),
      segments,
      metadata: {
        source: 'user',
        contextToken,
        rawMessage: msg
      },
      rawEvent
    };
  }

  async resolveResource(resource: ResourceHandle, rawEvent?: unknown): Promise<ResourceHandle | null> {
    if (resource.localPath) {
      return resource;
    }

    const msg = rawEvent as any;
    if (!msg?.weixinMessage?.item_list) {
      return resource;
    }

    const outputDir = join(channelPaths.weixin.root(), 'inbound-media', resource.resourceId);
    const item = this.findMessageItemByResource(msg.weixinMessage.item_list, resource);

    if (!item) {
      return resource;
    }

    try {
      const resolved = await this.facade.resolveInboundMedia({
        item,
        outputDir,
        cdnBaseUrl: CDN_BASE_URL
      });
      return resolved || resource;
    } catch (err) {
      this.log.warn(`Failed to resolve resource: ${err}`);
      return resource;
    }
  }

  async send(message: ChannelMessage, _context: ChannelSendContext): Promise<AdapterSendResult> {
    if (!this.config.token) {
      throw new Error('Weixin not logged in');
    }

    const toUserId = message.conversation.id;
    const contextToken = this.config.contextTokens?.[toUserId];

    if (!contextToken) {
      throw new Error(`No contextToken for conversation ${toUserId}`);
    }

    let platformMessageId: string | undefined;

    for (const segment of message.segments) {
      if (segment.type === 'text' && segment.text) {
        const result = await this.facade.sendText({
          baseUrl: this.config.baseUrl,
          token: this.config.token,
          toUserId,
          contextToken,
          text: segment.text
        });
        platformMessageId = result.messageId;
      } else if (segment.type === 'image' || segment.type === 'file' || segment.type === 'audio' || segment.type === 'video') {
        const filePath = this.requireLocalPath(segment.resource);
        const result = await this.facade.sendMedia({
          baseUrl: this.config.baseUrl,
          cdnBaseUrl: CDN_BASE_URL,
          token: this.config.token,
          toUserId,
          contextToken,
          filePath,
          kind: segment.resource.kind
        });
        platformMessageId = result.messageId;
      }
    }

    return { platformMessageId };
  }

  classifyError(error: unknown): { retryable: boolean; code: string; message?: string } {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = /timeout|network|ECONN|HTTP 5\d\d|temporarily|session.*expired/i.test(message);
    return {
      retryable,
      code: retryable ? 'transport_error' : 'send_failed',
      message
    };
  }

  private async runLongPoll(): Promise<void> {
    let syncCursor = '';

    while (this.running && !this.abortController?.signal.aborted) {
      try {
        const result = await this.facade.getUpdates({
          baseUrl: this.config.baseUrl,
          token: this.config.token!,
          syncCursor,
          timeoutMs: 35_000,
          signal: this.abortController?.signal
        });

        if (result.sessionExpired) {
          this.log.warn('Session expired, need re-login');
          this.config.token = undefined;
          await this.saveState();
          await this.performQrLogin();
          syncCursor = '';
          continue;
        }

        syncCursor = result.nextSyncCursor;

        for (const msg of result.messages) {
          await this.processInboundMessage(msg);
        }
      } catch (err) {
        if (this.abortController?.signal.aborted) {
          break;
        }
        this.log.error(`Long poll error: ${err}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async processInboundMessage(msg: any): Promise<void> {
    if (!msg.from_user_id || !msg.to_user_id) {
      return;
    }

    const draft = await this.decodeInbound({ weixinMessage: msg });
    if (draft && this.runtimeContext) {
      await this.runtimeContext.ingest({ weixinMessage: msg });
    }
  }

  private async performQrLogin(): Promise<void> {
    const startResult = await this.facade.startQrLogin({
      baseUrl: this.config.baseUrl,
      signal: this.abortController?.signal
    });

    this.log.info('\n=== 微信扫码登录 ===');
    this.log.info('请使用微信扫描二维码完成登录\n');

    const loginResult = await this.facade.waitForQrLogin({
      baseUrl: this.config.baseUrl,
      sessionKey: startResult.sessionKey,
      signal: this.abortController?.signal
    });

    this.config.token = loginResult.token;
    this.config.userId = loginResult.userId;
    this.config.contextTokens = {};
    await this.saveState();

    this.log.info('微信登录成功！');
  }

  private async loadState(): Promise<void> {
    try {
      const statePath = join(channelPaths.weixin.root(), STATE_FILE);
      const data = await readFile(statePath, 'utf-8');
      const state: SavedState = JSON.parse(data);
      if (state.token) {
        this.config.token = state.token;
      }
      if (state.userId) {
        this.config.userId = state.userId;
      }
      if (state.contextTokens) {
        this.config.contextTokens = state.contextTokens;
      }
    } catch {
    }
  }

  private async saveState(): Promise<void> {
    try {
      const configDir = channelPaths.weixin.root();
      await mkdir(configDir, { recursive: true });
      const statePath = join(configDir, STATE_FILE);
      const state: SavedState = {
        token: this.config.token,
        userId: this.config.userId,
        contextTokens: this.config.contextTokens
      };
      await writeFile(statePath, JSON.stringify(state, null, 2));
    } catch (err) {
      this.log.warn(`Failed to save state: ${err}`);
    }
  }

  private getOrCreateContextToken(convId: string, senderId: string): string {
    if (this.config.contextTokens?.[convId]) {
      return this.config.contextTokens[convId];
    }
    return `${convId}:${senderId}:${randomBytes(4).toString('hex')}`;
  }

  private decodeMessageItem(item: MessageItem): MessageSegment | null {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      return { type: 'text', text: item.text_item.text };
    }

    if (item.type === MessageItemType.IMAGE) {
      return {
        type: 'image',
        resource: this.buildMediaResource('image', item)
      };
    }

    if (item.type === MessageItemType.VOICE) {
      return {
        type: 'audio',
        resource: this.buildMediaResource('audio', item)
      };
    }

    if (item.type === MessageItemType.VIDEO) {
      return {
        type: 'video',
        resource: this.buildMediaResource('video', item)
      };
    }

    if (item.type === MessageItemType.FILE && item.file_item) {
      return {
        type: 'file',
        resource: this.buildFileResource(item)
      };
    }

    return { type: 'unsupported', originalType: String(item.type), text: `[消息类型:${item.type}]` };
  }

  private buildMediaResource(kind: ResourceHandle['kind'], item: MessageItem): ResourceHandle {
    const resourceId = randomBytes(4).toString('hex');
    let mediaRef: any;

    if (kind === 'image' && item.image_item) {
      mediaRef = item.image_item;
    } else if (kind === 'audio' && item.voice_item) {
      mediaRef = item.voice_item;
    } else if (kind === 'video' && item.video_item) {
      mediaRef = item.video_item;
    }

    return {
      resourceId,
      kind,
      originalName: `${kind}-${resourceId}`,
      platformFileId: mediaRef?.media?.encrypt_query_param
    };
  }

  private buildFileResource(item: MessageItem): ResourceHandle {
    const resourceId = randomBytes(4).toString('hex');
    const fileItem = item.file_item!;
    return {
      resourceId,
      kind: 'file',
      originalName: fileItem.file_name || `file-${resourceId}`,
      size: fileItem.len ? parseInt(String(fileItem.len)) : undefined,
      platformFileId: fileItem.media?.encrypt_query_param
    };
  }

  private findMessageItemByResource(itemList: MessageItem[], resource: ResourceHandle): MessageItem | null {
    for (const item of itemList) {
      if (item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param === resource.platformFileId) {
        return item;
      }
      if (item.type === MessageItemType.VOICE && item.voice_item?.media?.encrypt_query_param === resource.platformFileId) {
        return item;
      }
      if (item.type === MessageItemType.VIDEO && item.video_item?.media?.encrypt_query_param === resource.platformFileId) {
        return item;
      }
      if (item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param === resource.platformFileId) {
        return item;
      }
    }
    return null;
  }

  private requireLocalPath(resource: ResourceHandle): string {
    const localPath = resource.localPath;
    if (!localPath) {
      throw new Error(`Resource local path missing: ${resource.originalName}`);
    }
    return localPath;
  }
}

const plugin: ChannelPluginDefinition = {
  pluginName: 'channel_weixin',
  channelName: 'weixin',
  create: (config) => new WeixinAdapter(config as Partial<WeixinConfig>)
};

export default plugin;