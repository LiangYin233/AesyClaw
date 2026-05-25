/** channel_weixin — 微信频道插件（iLink 协议） */

import type { ChannelPlugin, ChannelContext, OutboundSignal } from '@aesyclaw/sdk';
import { prepareQR, pollLogin, type LoginResult } from './login';
import { startMonitor } from './monitor';
import { sendMessage, notifyStart, notifyStop } from './api';

// ─── 模块状态 ───────────────────────────────────────────────────────

let context: ChannelContext | null = null;
let token = '';
let baseUrl = '';
let monitor: ReturnType<typeof startMonitor> | null = null;
let destroyed = false;

const CREDENTIALS_PATH = 'channels.weixin';

// ─── 插件定义 ──────────────────────────────────────────────────────

export const channel: ChannelPlugin = {
  name: 'weixin',
  version: '0.1.0',
  description: '微信频道 — 通过 iLink 协议接入，支持单聊消息收发',
  streaming: false,
  defaultConfig: { enabled: false },

  async init(ctx: ChannelContext) {
    context = ctx;
    destroyed = false;

    // 恢复已保存的凭据
    const cfg = ctx.config as Record<string, unknown>;
    const savedToken = cfg['token'] as string | undefined;
    const savedBaseUrl = cfg['baseUrl'] as string | undefined;
    const updatesBuf = cfg['updatesBuf'] as string | undefined;

    if (savedToken && savedBaseUrl) {
      token = savedToken;
      baseUrl = savedBaseUrl;
      ctx.logger.info('微信频道: 已加载保存的凭据');

      try {
        await notifyStart({ baseUrl, token });
      } catch { /* 通知失败不影响启动 */ }

      startWeixinMonitor(updatesBuf, ctx);
    }

    // 注册命令
    ctx.registerCommand({
      name: 'weixin_login',
      description: '微信扫码登录',
      scope: 'system',
      allowDuringAgentProcessing: false,
      execute: async () => {
        try {
          const qr = await prepareQR(ctx.paths.mediaDir);

          // 后台启动轮询
          void pollLogin(qr.qrCode, 480_000, (status) => {
            ctx.logger.info(`微信扫码状态: ${status}`);
            if (status === 'confirmed') {
              ctx.logger.info('微信扫码确认，正在保存凭据');
            }
          }).then(async (result) => {
            if (result.success && result.token && result.baseUrl) {
              token = result.token;
              baseUrl = result.baseUrl;
              await ctx.configManager.set(CREDENTIALS_PATH, {
                token, baseUrl, enabled: true, updatesBuf: '',
              });
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
    if (monitor) {
      monitor.stop();
      monitor = null;
    }
    if (token && baseUrl) {
      try { await notifyStop({ baseUrl, token }); } catch {}
    }
    context = null;
    token = '';
    baseUrl = '';
  },

  async receive() {
    // 入站消息由 monitor 处理，此函数预留
  },

  async send(signal: OutboundSignal) {
    if (!token || !baseUrl || destroyed) return;
    if (signal.kind === 'message') {
      const text = extractPlainText(signal.content);
      if (text) {
        await sendMessage({
          baseUrl,
          token,
          body: {
            msg: {
              to_user_id: signal.session.chatId,
              message_type: 2,
              message_state: 2,
              item_list: [{ type: 1, text_item: { text } }],
            },
          },
        });
      }
    }
  },
};

// ─── 内部函数 ──────────────────────────────────────────────────────

function startWeixinMonitor(updatesBuf: string | undefined, ctx: ChannelContext) {
  if (monitor) monitor.stop();
  monitor = startMonitor(
    { baseUrl, token },
    {
      onMessage: (fromUserId, content, msg) => {
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

function extractPlainText(message: { components: unknown[] }): string {
  for (const comp of message.components as Array<{ type?: string; text?: string }>) {
    if (comp.type === 'Plain' && comp.text) return comp.text;
  }
  return '';
}

export default channel;
