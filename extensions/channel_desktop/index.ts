/** channel_desktop — AesyClaw 桌面客户端频道插件。
 *
 * 启动 WebSocket 服务器，接受 Electron 桌面客户端连接，
 * 桥接消息到 AesyClaw Pipeline 并转发流式事件。
 */

import type { ChannelPlugin, ChannelContext, OutboundSignal } from '@aesyclaw/sdk';
import { DesktopServer } from './desktop-server';

// ─── 配置类型 ──────────────────────────────────────────────────────

type DesktopChannelConfig = {
  port: number;
  host: string;
  authToken: string;
};

const DEFAULT_CONFIG: DesktopChannelConfig = {
  port: 9730,
  host: '127.0.0.1',
  authToken: 'desktop-local',
};

// ─── 插件实例 ──────────────────────────────────────────────────────

let server: DesktopServer | null = null;

export const channel: ChannelPlugin = {
  name: 'desktop',
  version: '0.1.0',
  description: 'AesyClaw Desktop — Electron 桌面客户端频道',
  defaultConfig: DEFAULT_CONFIG as unknown as Record<string, unknown>,

  async init(ctx: ChannelContext): Promise<void> {
    const config = ctx.config as unknown as DesktopChannelConfig;
    const authToken = config.authToken;
    const adminToken = (ctx.configManager.get('server.authToken') as string | undefined) ?? '';
    const commands = ctx.getCommands().map((cmd) => ({
      name: cmd.namespace ? `${cmd.namespace} ${cmd.name}` : cmd.name,
      description: cmd.description ?? '',
    }));

    server = new DesktopServer({
      port: config.port ?? 9730,
      host: config.host ?? '127.0.0.1',
      authToken,
      adminToken,
      commands,
      context: ctx,
    });

    await server.start();
    ctx.logger.info(`Desktop 频道已启动，端口: ${config.port}`);
  },

  async destroy(): Promise<void> {
    await server?.stop();
    server = null;
  },

  receive,
  send,
};

/**
 * 接收入站消息（由 ChannelContext.receive 回调触发）。
 * Pipeline 处理完成后，ChannelManager 会调用 send() 投递结果。
 */
async function receive(): Promise<void> {
  // 入站消息由 DesktopServer.handleChatMessage 直接调用 context.receive()
  // 此函数预留，当前通过 context.receive 路径处理
}

/**
 * 发送出站信号。
 *
 * 由 ChannelManager.send() 调用。
 */
async function send(signal: OutboundSignal): Promise<void> {
  if (!server) return;

  const sessionId = signal.session.chatId;

  switch (signal.kind) {
    case 'chunk':
    case 'toolCall':
    case 'toolResult':
    case 'done':
    case 'error':
      server.forwardStreamEvent(sessionId, signal);
      return;

    case 'message': {
      const { text, media } = extractMessageContent(signal.content as { components: unknown[] });

      if (media.length > 0) {
        server.sendToSession(sessionId, {
          type: 'media',
          sessionId,
          text,
          items: media,
        } satisfies DesktopOutboundMessage);
      } else {
        server.sendToSession(sessionId, { type: 'chunk', sessionId, text, index: 0 });
      }

      if (!signal.intermediate) {
        server.sendToSession(sessionId, { type: 'done', sessionId });
      }
      return;
    }
  }
}

import type { DesktopMediaItem, DesktopOutboundMessage } from './types';

type Component = { type: string; text?: string; base64?: string; mimeType?: string; name?: string; url?: string; path?: string };

function extractMessageContent(msg: { components: unknown[] }): {
  text: string;
  media: DesktopMediaItem[];
} {
  const textParts: string[] = [];
  const media: DesktopMediaItem[] = [];

  for (const comp of msg.components as Component[]) {
    if (comp.type === 'Plain' && comp.text) {
      textParts.push(comp.text);
    } else if (comp.type === 'Image') {
      media.push({ kind: 'image', base64: comp.base64, mimeType: comp.mimeType });
    } else if (comp.type === 'Record') {
      media.push({ kind: 'audio', base64: comp.base64, mimeType: comp.mimeType });
    } else if (comp.type === 'Video') {
      media.push({ kind: 'video', base64: comp.base64, mimeType: comp.mimeType });
    } else if (comp.type === 'File') {
      media.push({ kind: 'file', base64: comp.base64, mimeType: comp.mimeType, name: comp.name });
    }
  }

  return { text: textParts.join('\n'), media };
}

export default channel;
