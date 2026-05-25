/** channel_weixin — 微信频道插件（iLink 协议） */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChannelPlugin, ChannelContext, OutboundSignal } from '@aesyclaw/sdk';
import { prepareQR, pollLogin } from './login';
import { startMonitor } from './monitor';
import { sendMessage, notifyStart, notifyStop } from './api';

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

      try { await notifyStart({ baseUrl, token }); } catch { /* 忽略 */ }

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
              try { await notifyStart({ baseUrl, token }); } catch {}
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
    if (monitor) { monitor.stop(); monitor = null; }
    if (token && baseUrl) {
      try { await notifyStop({ baseUrl, token }); } catch {}
    }
    token = '';
    baseUrl = '';
  },

  async receive() {},

  async send(signal: OutboundSignal) {
    if (!token || !baseUrl || destroyed) return;
    if (signal.kind === 'message') {
      const parts = extractMessageParts(signal.content as { components: unknown[] });
      const text = parts.text;
      const mediaDesc = parts.media.length > 0
        ? '\n\n[附件]\n' + parts.media.map((m) => `- ${m.name || m.kind}`).join('\n')
        : '';
      const finalText = text + mediaDesc;
      if (finalText) {
        await sendMessage({
          baseUrl, token,
          body: {
            msg: {
              to_user_id: signal.session.chatId,
              message_type: 2,
              message_state: 2,
              item_list: [{ type: 1, text_item: { text: finalText } }],
            },
          },
        });
      }
    }
  },
};

// ─── 内部函数 ──────────────────────────────────────────────────────

type Component = { type: string; text?: string; name?: string; kind?: string };

function extractMessageParts(msg: { components: unknown[] }): { text: string; media: Component[] } {
  const texts: string[] = [];
  const media: Component[] = [];
  for (const comp of msg.components as Component[]) {
    if (comp.type === 'Plain' && comp.text) {
      texts.push(comp.text);
    } else if (comp.type === 'Image' || comp.type === 'File' || comp.type === 'Record' || comp.type === 'Video') {
      media.push(comp);
    }
  }
  return { text: texts.join('\n'), media };
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
      onError: (err) => { ctx.logger.error(`微信监控错误: ${err}`); },
    },
    ctx.logger,
    updatesBuf,
  );
}

export default channel;
