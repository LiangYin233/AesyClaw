import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import qrcodeTerminal from 'qrcode-terminal';
import { logger as baseLogger } from '../../src/platform/observability/index.ts';
import type { ResourceHandle } from '../../src/features/channels/domain/types.ts';
import type { WeixinMessageItem } from './message-mapping.ts';
import { downloadMediaFromItem } from '@tencent-weixin/openclaw-weixin/src/media/media-download.ts';
import { uploadBufferToCdn } from '@tencent-weixin/openclaw-weixin/src/cdn/cdn-upload.ts';
import { aesEcbPaddedSize } from '@tencent-weixin/openclaw-weixin/src/cdn/aes-ecb.ts';
import { getMimeFromFilename, getExtensionFromMime } from '@tencent-weixin/openclaw-weixin/src/media/mime.ts';
import type { GetUpdatesResp, MessageItem, WeixinMessage } from '@tencent-weixin/openclaw-weixin/src/api/types.ts';

const DEFAULT_LOGIN_BOT_TYPE = '3';
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const WEIXIN_HEADER_AUTH_TYPE = 'ilink_bot_token';
const WEIXIN_SESSION_EXPIRED_ERRCODE = -14;

type LoggerLike = {
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
};

export interface QrLoginStartResult {
  sessionKey: string;
  qrCodeUrl: string;
  qrCodeAscii?: string;
}

export interface QrLoginResult {
  token: string;
  userId?: string;
}

export interface WeixinPollResult {
  messages: WeixinMessage[];
  nextSyncCursor: string;
  nextTimeoutMs?: number;
  sessionExpired?: boolean;
}

export interface WeixinFacade {
  startQrLogin(args: { baseUrl: string; signal?: AbortSignal }): Promise<QrLoginStartResult>;
  waitForQrLogin(args: { baseUrl: string; sessionKey: string; signal?: AbortSignal }): Promise<QrLoginResult>;
  getUpdates(args: {
    baseUrl: string;
    token: string;
    syncCursor: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<WeixinPollResult>;
  sendText(args: {
    baseUrl: string;
    token: string;
    toUserId: string;
    contextToken: string;
    text: string;
  }): Promise<{ messageId: string }>;
  sendMedia(args: {
    baseUrl: string;
    cdnBaseUrl: string;
    token: string;
    toUserId: string;
    contextToken: string;
    filePath: string;
    kind: ResourceHandle['kind'];
    text?: string;
  }): Promise<{ messageId: string }>;
  resolveInboundMedia(args: {
    item: WeixinMessageItem;
    outputDir: string;
    cdnBaseUrl: string;
  }): Promise<ResourceHandle | null>;
}

function encodeWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), 'utf-8').toString('base64');
}

function createLogger(logger?: LoggerLike): LoggerLike {
  return logger || baseLogger.child('Weixin');
}

function buildHeaders(body: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
    AuthorizationType: WEIXIN_HEADER_AUTH_TYPE,
    'X-WECHAT-UIN': encodeWechatUin()
  };

  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  return headers;
}

async function postJson<T>(args: {
  baseUrl: string;
  endpoint: string;
  body: Record<string, unknown>;
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const payload = JSON.stringify({
    ...args.body,
    base_info: {
      channel_version: 'aesyclaw-weixin'
    }
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), args.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);
  const onAbort = () => controller.abort(args.signal?.reason);
  args.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const url = new URL(args.endpoint, args.baseUrl.endsWith('/') ? args.baseUrl : `${args.baseUrl}/`);
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(payload, args.token),
      body: payload,
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw}`);
    }
    return JSON.parse(raw) as T;
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener('abort', onAbort);
  }
}

function fileKindToUploadMediaType(kind: ResourceHandle['kind']): number {
  if (kind === 'image') {
    return 1;
  }
  if (kind === 'video') {
    return 2;
  }
  if (kind === 'audio') {
    return 4;
  }
  return 3;
}

function fileKindToMessageItem(args: {
  kind: ResourceHandle['kind'];
  fileName: string;
  fileSize: number;
  fileSizeCiphertext: number;
  encryptQueryParam: string;
  aesKeyHex: string;
}): MessageItem {
  const baseMedia = {
    encrypt_query_param: args.encryptQueryParam,
    aes_key: Buffer.from(args.aesKeyHex).toString('base64'),
    encrypt_type: 1
  };

  if (args.kind === 'image') {
    return {
      type: 2,
      image_item: {
        media: baseMedia,
        mid_size: args.fileSizeCiphertext
      }
    };
  }

  if (args.kind === 'video') {
    return {
      type: 5,
      video_item: {
        media: baseMedia,
        video_size: args.fileSizeCiphertext
      }
    };
  }

  if (args.kind === 'audio') {
    const ext = extname(args.fileName).toLowerCase();
    const encodeType = ext === '.mp3'
      ? 7
      : ext === '.ogg'
        ? 8
        : ext === '.wav'
          ? 1
          : 6;

    return {
      type: 3,
      voice_item: {
        media: baseMedia,
        encode_type: encodeType
      }
    };
  }

  return {
    type: 4,
    file_item: {
      media: baseMedia,
      file_name: args.fileName,
      len: String(args.fileSize)
    }
  };
}

async function uploadMedia(args: {
  baseUrl: string;
  cdnBaseUrl: string;
  token: string;
  toUserId: string;
  filePath: string;
  kind: ResourceHandle['kind'];
}): Promise<{
  item: MessageItem;
}> {
  const fileBuffer = await readFile(args.filePath);
  const aesKey = randomBytes(16);
  const fileKey = randomBytes(16).toString('hex');
  const rawFileMd5 = createHash('md5').update(fileBuffer).digest('hex');
  const uploadUrl = await postJson<{
    upload_param?: string;
    ret?: number;
    errcode?: number;
    errmsg?: string;
  }>({
    baseUrl: args.baseUrl,
    endpoint: 'ilink/bot/getuploadurl',
    token: args.token,
    body: {
      filekey: fileKey,
      media_type: fileKindToUploadMediaType(args.kind),
      to_user_id: args.toUserId,
      rawsize: fileBuffer.length,
      rawfilemd5: rawFileMd5,
      filesize: aesEcbPaddedSize(fileBuffer.length),
      no_need_thumb: true,
      aeskey: aesKey.toString('hex')
    }
  });

  if ((uploadUrl.ret !== undefined && uploadUrl.ret !== 0) || (uploadUrl.errcode !== undefined && uploadUrl.errcode !== 0) || !uploadUrl.upload_param) {
    throw new Error(uploadUrl.errmsg || `微信媒体上传初始化失败: ret=${uploadUrl.ret ?? 0}, errcode=${uploadUrl.errcode ?? 0}`);
  }

  const uploaded = await uploadBufferToCdn({
    buf: fileBuffer,
    uploadParam: uploadUrl.upload_param,
    filekey: fileKey,
    cdnBaseUrl: args.cdnBaseUrl,
    label: 'weixin-media-upload',
    aeskey: aesKey
  });

  return {
    item: fileKindToMessageItem({
      kind: args.kind,
      fileName: basename(args.filePath),
      fileSize: fileBuffer.length,
      fileSizeCiphertext: aesEcbPaddedSize(fileBuffer.length),
      encryptQueryParam: uploaded.downloadParam,
      aesKeyHex: aesKey.toString('hex')
    })
  };
}

function messageIdFromResponse(): string {
  return randomBytes(8).toString('hex');
}

async function sendMessageItems(args: {
  baseUrl: string;
  token: string;
  toUserId: string;
  contextToken: string;
  items: MessageItem[];
}): Promise<{ messageId: string }> {
  let lastMessageId = messageIdFromResponse();
  for (const item of args.items) {
    lastMessageId = messageIdFromResponse();
    await postJson<Record<string, unknown>>({
      baseUrl: args.baseUrl,
      endpoint: 'ilink/bot/sendmessage',
      token: args.token,
      body: {
        msg: {
          from_user_id: '',
          to_user_id: args.toUserId,
          client_id: lastMessageId,
          message_type: 2,
          message_state: 2,
          context_token: args.contextToken,
          item_list: [item]
        }
      }
    });
  }

  return { messageId: lastMessageId };
}

export function createWeixinFacade(logger?: LoggerLike): WeixinFacade {
  const log = createLogger(logger);

  return {
    async startQrLogin(args) {
      const response = await fetch(new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_LOGIN_BOT_TYPE)}`, args.baseUrl.endsWith('/') ? args.baseUrl : `${args.baseUrl}/`), {
        signal: args.signal
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`微信二维码获取失败: ${response.status} ${raw}`);
      }

      const parsed = JSON.parse(raw) as {
        qrcode?: string;
        qrcode_img_content?: string;
      };

      if (!parsed.qrcode || !parsed.qrcode_img_content) {
        throw new Error('微信二维码响应缺少必要字段');
      }

      let qrCodeAscii: string | undefined;
      await new Promise<void>((resolve) => {
        qrcodeTerminal.generate(parsed.qrcode_img_content!, { small: true }, (output: string) => {
          qrCodeAscii = output;
          resolve();
        });
      });

      return {
        sessionKey: parsed.qrcode,
        qrCodeUrl: parsed.qrcode_img_content,
        qrCodeAscii
      };
    },

    async waitForQrLogin(args) {
      while (!args.signal?.aborted) {
        const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(args.sessionKey)}`, args.baseUrl.endsWith('/') ? args.baseUrl : `${args.baseUrl}/`);
        const response = await fetch(url, {
          headers: {
            'iLink-App-ClientVersion': '1'
          },
          signal: args.signal
        });
        const raw = await response.text();
        if (!response.ok) {
          throw new Error(`微信二维码状态查询失败: ${response.status} ${raw}`);
        }

        const parsed = JSON.parse(raw) as {
          status?: string;
          bot_token?: string;
          ilink_user_id?: string;
        };

        if (parsed.status === 'confirmed' && parsed.bot_token) {
          return {
            token: parsed.bot_token,
            userId: parsed.ilink_user_id
          };
        }

        if (parsed.status === 'expired') {
          throw new Error('qr_expired');
        }

        if (parsed.status === 'wait' || parsed.status === 'scaned') {
          continue;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      throw new Error('登录等待已取消');
    },

    async getUpdates(args) {
      const response = await postJson<GetUpdatesResp>({
        baseUrl: args.baseUrl,
        endpoint: 'ilink/bot/getupdates',
        token: args.token,
        timeoutMs: args.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
        signal: args.signal,
        body: {
          get_updates_buf: args.syncCursor
        }
      });

      if (response.errcode === WEIXIN_SESSION_EXPIRED_ERRCODE || response.ret === WEIXIN_SESSION_EXPIRED_ERRCODE) {
        return {
          messages: [],
          nextSyncCursor: args.syncCursor,
          sessionExpired: true
        };
      }

      if ((response.ret !== undefined && response.ret !== 0) || (response.errcode !== undefined && response.errcode !== 0)) {
        throw new Error(response.errmsg || `微信长轮询失败: ret=${response.ret ?? 0}, errcode=${response.errcode ?? 0}`);
      }

      return {
        messages: response.msgs || [],
        nextSyncCursor: typeof response.get_updates_buf === 'string' ? response.get_updates_buf : args.syncCursor,
        nextTimeoutMs: response.longpolling_timeout_ms
      };
    },

    async sendText(args) {
      const result = await sendMessageItems({
        baseUrl: args.baseUrl,
        token: args.token,
        toUserId: args.toUserId,
        contextToken: args.contextToken,
        items: [
          {
            type: 1,
            text_item: {
              text: args.text
            }
          }
        ]
      });
      log.debug('微信文本已发送', { toUserId: args.toUserId });
      return result;
    },

    async sendMedia(args) {
      const upload = await uploadMedia({
        baseUrl: args.baseUrl,
        cdnBaseUrl: args.cdnBaseUrl,
        token: args.token,
        toUserId: args.toUserId,
        filePath: args.filePath,
        kind: args.kind
      });

      const items: MessageItem[] = [];
      if (args.text?.trim()) {
        items.push({
          type: 1,
          text_item: {
            text: args.text.trim()
          }
        });
      }
      items.push(upload.item);

      return sendMessageItems({
        baseUrl: args.baseUrl,
        token: args.token,
        toUserId: args.toUserId,
        contextToken: args.contextToken,
        items
      });
    },

    async resolveInboundMedia(args) {
      await mkdir(args.outputDir, { recursive: true });
      const media = await downloadMediaFromItem(args.item as MessageItem, {
        cdnBaseUrl: args.cdnBaseUrl,
        label: 'aesyclaw-weixin-inbound',
        log: (message) => log.info(message),
        errLog: (message) => log.error(message),
        saveMedia: async (buffer, contentType, _subdir, _maxBytes, originalFilename) => {
          const name = originalFilename
            ? `${randomBytes(4).toString('hex')}-${originalFilename}`
            : `${randomBytes(4).toString('hex')}${getExtensionFromMime(contentType || 'application/octet-stream')}`;
          const targetPath = join(args.outputDir, name);
          await writeFile(targetPath, buffer);
          return { path: targetPath };
        }
      });

      if (media.decryptedPicPath) {
        return {
          resourceId: randomBytes(4).toString('hex'),
          kind: 'image',
          originalName: basename(media.decryptedPicPath),
          mimeType: 'image/*',
          localPath: media.decryptedPicPath
        };
      }

      if (media.decryptedVideoPath) {
        return {
          resourceId: randomBytes(4).toString('hex'),
          kind: 'video',
          originalName: basename(media.decryptedVideoPath),
          mimeType: 'video/mp4',
          localPath: media.decryptedVideoPath
        };
      }

      if (media.decryptedVoicePath) {
        return {
          resourceId: randomBytes(4).toString('hex'),
          kind: 'audio',
          originalName: basename(media.decryptedVoicePath),
          mimeType: media.voiceMediaType || getMimeFromFilename(media.decryptedVoicePath),
          localPath: media.decryptedVoicePath
        };
      }

      if (media.decryptedFilePath) {
        return {
          resourceId: randomBytes(4).toString('hex'),
          kind: 'file',
          originalName: basename(media.decryptedFilePath),
          mimeType: media.fileMediaType || getMimeFromFilename(media.decryptedFilePath),
          localPath: media.decryptedFilePath
        };
      }

      return null;
    }
  };
}
