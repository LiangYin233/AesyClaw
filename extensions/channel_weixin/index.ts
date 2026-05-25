/** channel_weixin — 微信频道插件（iLink 协议） */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChannelPlugin, ChannelContext, OutboundSignal } from '@aesyclaw/sdk';
import { prepareQR, pollLogin } from './login';
import { startMonitor } from './monitor';
import { sendMessage, notifyStart, notifyStop } from './api';
import { uploadToCdn } from './cdn';

// ─── 模块状态 ───────────────────────────────────────────────────────

let token = '';
let baseUrl = '';
let monitor: ReturnType<typeof startMonitor> | null = null;
let destroyed = false;

// ─── 凭据文件 ───────────────────────────────────────────────────────

const CRED_FILE = 'weixin-credentials.json';

type Credentials = { token: string; baseUrl: string; updatesBuf?: string };

function credPath(ctx: ChannelContext): string {
  return path.join(ctx.paths.dataDir, CRED_FILE);
}

async function loadCreds(ctx: ChannelContext): Promise<Credentials | null> {
  try {
    const data = await fs.readFile(credPath(ctx), 'utf-8');
    return JSON.parse(data) as Credentials;
  } catch {
    return null;
  }
}

async function saveCreds(ctx: ChannelContext, c: Credentials): Promise<void> {
  await fs.mkdir(ctx.paths.dataDir, { recursive: true });
  await fs.writeFile(credPath(ctx), JSON.stringify(c, null, 2), 'utf-8');
}

// ─── 插件定义 ──────────────────────────────────────────────────────

export const channel: ChannelPlugin = {
  name: 'weixin',
  version: '0.1.0',
  description: '微信频道 — 通过 iLink 协议接入，支持单聊消息收发',
  streaming: false,
  defaultConfig: { enabled: false },

  async init(ctx: ChannelContext) {
    destroyed = false;

    const creds = await loadCreds(ctx);
    if (creds?.token && creds?.baseUrl) {
      token = creds.token;
      baseUrl = creds.baseUrl;
      ctx.logger.info('微信频道: 已加载凭据');
      try {
        await notifyStart({ baseUrl, token });
      } catch {
        /* 忽略 */
      }
      startWeixinMonitor(creds.updatesBuf, ctx);
    }

    ctx.registerCommand({
      name: 'weixin_login',
      description: '微信扫码登录',
      scope: 'system',
      allowDuringAgentProcessing: false,
      execute: async () => {
        try {
          const qr = await prepareQR(ctx.paths.mediaDir);
          void pollLogin(qr.qrCode, 480_000, (status) => {
            ctx.logger.info(`微信扫码状态: ${status}`);
          }).then(async (result) => {
            if (result.success && result.token && result.baseUrl) {
              token = result.token;
              baseUrl = result.baseUrl;
              await saveCreds(ctx, { token, baseUrl });
              ctx.logger.info('微信凭据已保存');
              try {
                await notifyStart({ baseUrl, token });
              } catch {}
              startWeixinMonitor('', ctx);
            } else if (!result.success) {
              ctx.logger.error(`微信登录失败: ${result.message}`);
            }
          });
          return { components: [{ type: 'Plain', text: qr.message }] };
        } catch (err) {
          return { components: [{ type: 'Plain', text: `微信登录失败: ${err}` }] };
        }
      },
    });

    ctx.logger.info('微信频道已初始化');
  },

  async destroy() {
    destroyed = true;
    if (monitor) {
      monitor.stop();
      monitor = null;
    }
    if (token && baseUrl) {
      try {
        await notifyStop({ baseUrl, token });
      } catch {}
    }
    token = '';
    baseUrl = '';
  },

  async receive() {},

  async send(signal: OutboundSignal) {
    console.log('[weixin] send called', signal.kind, signal.session.chatId);
    if (!token || !baseUrl || destroyed) {
      console.log('[weixin] send skipped: token or baseUrl missing');
      return;
    }
    if (signal.kind !== 'message') return;

    const parts = extractMessageParts(signal.content as { components: unknown[] });

    // 每项单独发送（iLink 协议要求 item_list 每次只有一个元素）
    const tasks: Array<() => Promise<void>> = [];

    if (parts.text) {
      tasks.push(() => sendOneItem({ type: 1, text_item: { text: parts.text } }));
    }

    for (const media of parts.media) {
      tasks.push(() => handleMediaItem(media, signal.session.chatId));
    }

    for (const task of tasks) {
      try {
        await task();
      } catch (err) {
        try {
          await sendOneItem({ type: 1, text_item: { text: `[发送失败: ${err}]` } });
        } catch {}
      }
    }

    async function sendOneItem(item: Record<string, unknown>): Promise<void> {
      await sendMessage({
        baseUrl,
        token,
        body: {
          msg: {
            to_user_id: signal.session.chatId,
            message_type: 2,
            message_state: 2,
            item_list: [item],
          },
        },
      });
    }

    async function handleMediaItem(media: Component, chatId: string): Promise<void> {
      let fileBuffer: Buffer | undefined;
      if (media.base64) {
        fileBuffer = Buffer.from(media.base64, 'base64');
      } else if (media.path) {
        fileBuffer = await fs.readFile(media.path);
      }
      if (!fileBuffer) return;

      const mime = media.mimeType || guessMime(media.name || media.path || '');
      const mediaType = mime.startsWith('image/') ? 1 : mime.startsWith('video/') ? 2 : 3;
      const uploaded = await uploadToCdn(fileBuffer, chatId, mediaType, { baseUrl, token });
      const aesKeyBase64 = Buffer.from(uploaded.aeskey, 'hex').toString('base64');
      const cdnRef = {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: aesKeyBase64,
        encrypt_type: 1,
      };

      if (mediaType === 1) {
        await sendOneItem({
          type: 2,
          image_item: { media: cdnRef, mid_size: uploaded.fileSizeCiphertext },
        });
      } else if (mediaType === 2) {
        await sendOneItem({
          type: 5,
          video_item: { media: cdnRef, video_size: uploaded.fileSizeCiphertext },
        });
      } else {
        await sendOneItem({
          type: 4,
          file_item: {
            media: cdnRef,
            file_name: media.name || 'file',
            len: String(uploaded.fileSize),
          },
        });
      }
    }
  },
};

// ─── 内部函数 ──────────────────────────────────────────────────────

type Component = {
  type: string;
  text?: string;
  base64?: string;
  path?: string;
  name?: string;
  mimeType?: string;
};

function extractMessageParts(msg: { components: unknown[] }): { text: string; media: Component[] } {
  const texts: string[] = [];
  const media: Component[] = [];
  for (const comp of msg.components as Component[]) {
    if (comp.type === 'Plain' && comp.text) {
      texts.push(comp.text);
    } else if (['Image', 'Record', 'Video', 'File'].includes(comp.type)) {
      media.push(comp);
    }
  }
  return { text: texts.join('\n'), media };
}

function guessMime(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    txt: 'text/plain',
    json: 'application/json',
    md: 'text/markdown',
  };
  const mime = (ext ? map[ext] : undefined) as string | undefined;
  return mime ?? 'application/octet-stream';
}

function startWeixinMonitor(updatesBuf: string | undefined, ctx: ChannelContext) {
  if (monitor) monitor.stop();
  monitor = startMonitor(
    { baseUrl, token },
    {
      onMessage: (fromUserId, content) => {
        ctx.receive(
          { components: [{ type: 'Plain', text: content }] },
          { channel: 'weixin', type: 'private', chatId: fromUserId },
          { id: fromUserId, name: fromUserId },
        );
      },
      onError: (err) => {
        ctx.logger.error(`微信监控错误: ${err}`);
      },
    },
    ctx.logger,
    updatesBuf,
  );
}

export default channel;
