import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger as baseLogger } from '../../src/platform/observability/index.ts';
import type { ChannelAdapter, AdapterRuntimeContext, ChannelSendContext } from '../../src/features/channels/domain/adapter.ts';
import type {
  AdapterInboundDraft,
  AdapterSendResult,
  ChannelCapabilityProfile,
  ChannelMessage,
  MessageSegment
} from '../../src/features/channels/domain/types.ts';
import { createWeixinFacade, type WeixinFacade } from './openclaw-facade.ts';
import { mapInboundWeixinMessage, type WeixinInboundMessage } from './message-mapping.ts';
import { WeixinStateStore } from './state-store.ts';

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const DEFAULT_BACKOFF_DELAY_MS = 30_000;

type LoggerLike = {
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
  child?: (scope: string) => LoggerLike;
};

export interface WeixinChannelConfig {
  enabled?: boolean;
  baseUrl?: string;
  cdnBaseUrl?: string;
  qrCodeFile?: string;
}

function createLogger(logger?: LoggerLike): LoggerLike {
  const resolved = logger || baseLogger.child('Weixin');
  return typeof resolved.child === 'function' ? resolved.child('Channel') : resolved;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'aborted');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) {
      return;
    }

    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }, { once: true });
  });
}

function segmentText(segment: MessageSegment): string {
  if (segment.type === 'text') {
    return segment.text;
  }
  if (segment.type === 'mention') {
    return segment.display || `@${segment.userId}`;
  }
  if (segment.type === 'unsupported') {
    return segment.text || `[${segment.originalType}]`;
  }
  return '';
}

export class WeixinAdapter implements ChannelAdapter {
  readonly name = 'weixin';
  private readonly config: Required<Pick<WeixinChannelConfig, 'baseUrl' | 'cdnBaseUrl'>> & Pick<WeixinChannelConfig, 'qrCodeFile'>;
  private readonly stateStore: WeixinStateStore;
  private readonly facade: WeixinFacade;
  private readonly log: LoggerLike;
  private runtimeContext?: AdapterRuntimeContext;
  private running = false;
  private supervisorTask?: Promise<void>;
  private supervisorAbort?: AbortController;

  constructor(
    config: WeixinChannelConfig,
    deps?: {
      facade?: WeixinFacade;
      logger?: LoggerLike;
    }
  ) {
    this.config = {
      baseUrl: config.baseUrl?.trim() || DEFAULT_BASE_URL,
      cdnBaseUrl: config.cdnBaseUrl?.trim() || DEFAULT_CDN_BASE_URL,
      qrCodeFile: config.qrCodeFile?.trim() || undefined
    };
    this.stateStore = new WeixinStateStore();
    this.facade = deps?.facade || createWeixinFacade(deps?.logger);
    this.log = createLogger(deps?.logger);
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
    this.running = true;
    this.supervisorAbort = new AbortController();
    this.supervisorTask = this.runSupervisor(this.supervisorAbort.signal).catch((error) => {
      if (!isAbortError(error)) {
        this.log.error('微信渠道后台循环异常退出', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    this.log.info('微信渠道后台监督循环已启动');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.supervisorAbort?.abort();
    try {
      await this.supervisorTask;
    } catch {
      // ignore background cancellation errors
    }
    this.supervisorTask = undefined;
    this.supervisorAbort = undefined;
    this.log.info('微信渠道已停止');
  }

  isRunning(): boolean {
    return this.running;
  }

  async decodeInbound(rawEvent: any): Promise<AdapterInboundDraft | null> {
    const outputDir = join(this.stateStore.rootDir, 'inbound-media');

    return mapInboundWeixinMessage(rawEvent as WeixinInboundMessage, {
      resolveMediaItem: async (item, _index: number) => {
        const resolved = await this.facade.resolveInboundMedia({
          item,
          outputDir,
          cdnBaseUrl: this.config.cdnBaseUrl
        });

        if (resolved) {
          return resolved;
        }

        return null;
      },
      persistContextToken: async (peerId, token) => {
        await this.stateStore.setContextToken(peerId, token);
      }
    });
  }

  async send(message: ChannelMessage, _context: ChannelSendContext): Promise<AdapterSendResult> {
    const account = await this.stateStore.loadAccount();
    const token = account?.token?.trim();
    if (!token) {
      throw new Error('Weixin send failed: channel not logged in');
    }

    const peerId = message.conversation.id;
    const contextToken = await this.stateStore.getContextToken(peerId);
    if (!contextToken) {
      throw new Error(`Weixin send failed: context token missing for ${peerId}`);
    }

    let pendingText: string[] = [];
    let lastMessageId: string | undefined;

    const flushText = async () => {
      const text = pendingText.join('\n').trim();
      pendingText = [];
      if (!text) {
        return;
      }

      const result = await this.facade.sendText({
        baseUrl: this.config.baseUrl,
        token,
        toUserId: peerId,
        contextToken,
        text
      });
      lastMessageId = result.messageId;
    };

    for (const segment of message.segments) {
      if (segment.type === 'text' || segment.type === 'mention' || segment.type === 'unsupported') {
        const text = segmentText(segment);
        if (text.trim()) {
          pendingText.push(text);
        }
        continue;
      }

      if (segment.type === 'quote') {
        continue;
      }

      const caption = pendingText.join('\n').trim();
      pendingText = [];

      const filePath = segment.resource.localPath || segment.resource.remoteUrl;
      if (!filePath) {
        throw new Error(`Weixin send failed: resource path missing for ${segment.resource.originalName}`);
      }

      const result = await this.facade.sendMedia({
        baseUrl: this.config.baseUrl,
        cdnBaseUrl: this.config.cdnBaseUrl,
        token,
        toUserId: peerId,
        contextToken,
        filePath,
        kind: segment.resource.kind,
        text: caption
      });
      lastMessageId = result.messageId;
    }

    await flushText();

    if (!lastMessageId) {
      throw new Error('Weixin send failed: empty outbound payload');
    }

    return { platformMessageId: lastMessageId };
  }

  classifyError(error: unknown): { retryable: boolean; code: string; message?: string } {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = /timeout|network|ECONN|fetch failed|5\d\d|temporarily/i.test(message);
    return {
      retryable,
      code: retryable ? 'transport_error' : 'send_failed',
      message
    };
  }

  private async runSupervisor(signal: AbortSignal): Promise<void> {
    while (this.running && !signal.aborted) {
      try {
        let account = await this.stateStore.loadAccount();
        if (!account?.token) {
          account = await this.loginWithQr(signal);
        }

        const completedNormally = await this.runPollingLoop(account.token!, signal);
        if (completedNormally) {
          return;
        }
      } catch (error) {
        if (isAbortError(error) || signal.aborted) {
          return;
        }

        this.log.warn('微信监督循环将重试', {
          error: error instanceof Error ? error.message : String(error)
        });
        await delay(DEFAULT_RETRY_DELAY_MS, signal).catch(() => {});
      }
    }
  }

  private async loginWithQr(signal: AbortSignal) {
    const login = await this.facade.startQrLogin({
      baseUrl: this.config.baseUrl,
      signal
    });
    await this.outputQrCode(login.qrCodeAscii, login.qrCodeUrl);
    this.log.info('微信渠道等待扫码授权', { qrCodeUrl: login.qrCodeUrl });

    const result = await this.facade.waitForQrLogin({
      baseUrl: this.config.baseUrl,
      sessionKey: login.sessionKey,
      signal
    });

    await this.stateStore.saveAccount({
      token: result.token,
      userId: result.userId,
      contextTokens: {}
    });
    await this.stateStore.clearSyncCursor();
    this.log.info('微信扫码登录成功', { userId: result.userId });

    return (await this.stateStore.loadAccount()) || { token: result.token };
  }

  private async runPollingLoop(token: string, signal: AbortSignal): Promise<boolean> {
    let syncCursor = await this.stateStore.loadSyncCursor();
    let timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;
    let consecutiveFailures = 0;

    while (this.running && !signal.aborted) {
      try {
        const response = await this.facade.getUpdates({
          baseUrl: this.config.baseUrl,
          token,
          syncCursor,
          timeoutMs,
          signal
        });

        if (response.sessionExpired) {
          this.log.warn('微信登录态失效，重新进入扫码流程');
          await this.stateStore.clearToken();
          await this.stateStore.clearSyncCursor();
          return false;
        }

        syncCursor = response.nextSyncCursor;
        timeoutMs = response.nextTimeoutMs || timeoutMs;
        consecutiveFailures = 0;
        await this.stateStore.saveSyncCursor(syncCursor);

        for (const message of response.messages) {
          await this.runtimeContext?.ingest(message);
        }
      } catch (error) {
        if (isAbortError(error) || signal.aborted) {
          return true;
        }

        consecutiveFailures += 1;
        const retryDelay = consecutiveFailures >= 3 ? DEFAULT_BACKOFF_DELAY_MS : DEFAULT_RETRY_DELAY_MS;
        this.log.warn('微信长轮询失败，稍后重试', {
          error: error instanceof Error ? error.message : String(error),
          consecutiveFailures,
          retryDelay
        });
        await delay(retryDelay, signal).catch(() => {});
      }
    }

    return true;
  }

  private async outputQrCode(qrCodeAscii: string | undefined, qrCodeUrl: string): Promise<void> {
    if (qrCodeAscii) {
      this.log.info(`微信登录二维码\n${qrCodeAscii}`);
    } else {
      this.log.info(`微信登录二维码链接: ${qrCodeUrl}`);
    }

    if (!this.config.qrCodeFile) {
      return;
    }

    const content = `${qrCodeAscii || ''}\n${qrCodeUrl}\n`.trimStart();
    await mkdir(join(this.stateStore.rootDir, '..'), { recursive: true });
    await writeFile(this.config.qrCodeFile, content, 'utf-8');
  }
}
