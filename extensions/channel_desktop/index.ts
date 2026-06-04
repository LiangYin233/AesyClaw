/** channel_desktop — AesyClaw 桌面客户端频道插件。
 *
 * 启动 WebSocket 服务器，接受 Electron 桌面客户端连接，
 * 桥接消息到 AesyClaw Pipeline 并转发流式事件。
 */

import fs from 'node:fs/promises';
import type { ChannelPlugin, ChannelContext, OutboundSignal } from '@aesyclaw/sdk';

import type { DesktopMediaItem, DesktopOutboundMessage } from './types';
import { DesktopServer } from './desktop-server';
import { DesktopChannelConfigSchema, type DesktopChannelConfig } from './config-schema';

// ─── 插件实例 ──────────────────────────────────────────────────────

let server: DesktopServer | null = null;
export const channel: ChannelPlugin = {
  name: 'desktop',
  version: '0.1.0',
  description: 'AesyClaw Desktop — Electron 桌面客户端频道',
  streaming: true,
  defaultConfig: { port: 9730, host: '127.0.0.1', authToken: 'desktop-local' },
  configSchema: DesktopChannelConfigSchema,

  async init(ctx: ChannelContext): Promise<void> {
    const config = ctx.config as DesktopChannelConfig;

    const authToken = config.authToken;
    const getAdminToken = (): string =>
      (ctx.configManager.get('plugins.webui.authToken') as string | undefined) ?? '';

    server = new DesktopServer({
      port: config.port ?? 9730,
      host: config.host ?? '127.0.0.1',
      authToken,
      adminToken: getAdminToken,

      context: ctx,
    });

    await server.start();
    ctx.logger.info(`Desktop 频道已启动，端口: ${config.port}`);
  },

  async destroy(): Promise<void> {
    await server?.stop();
    server = null;
  },

  send,
};

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
      const { text, media } = await extractMessageContent(
        signal.content as { components: unknown[] },
      );

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

// ─── 媒体处理 ──────────────────────────────────────────────────────

const MEDIA_KIND_MAP: Record<string, DesktopMediaItem['kind']> = {
  Image: 'image',
  Record: 'audio',
  Video: 'video',
  File: 'file',
};

type Component = {
  type: string;
  text?: string;
  base64?: string;
  mimeType?: string;
  name?: string;
  url?: string;
  path?: string;
};

async function extractMessageContent(msg: {
  components: unknown[];
}): Promise<{ text: string; media: DesktopMediaItem[] }> {
  const textParts: string[] = [];
  const media: DesktopMediaItem[] = [];

  for (const comp of msg.components as Component[]) {
    if (comp.type === 'Plain' && comp.text) {
      textParts.push(comp.text);
      continue;
    }

    const kind = MEDIA_KIND_MAP[comp.type];
    if (!kind) continue;

    if (comp.base64) {
      media.push({ kind, base64: comp.base64, mimeType: comp.mimeType, name: comp.name });
    } else if (comp.path) {
      try {
        const data = await fs.readFile(comp.path);
        const pathParts = comp.path.split(/[/\\]+/);
        media.push({
          kind,
          base64: Buffer.from(data).toString('base64'),
          mimeType: comp.mimeType ?? guessMime(comp.path),
          name: comp.name ?? pathParts[pathParts.length - 1],
        });
      } catch {
        textParts.push(`[无法读取文件: ${comp.path}]`);
      }
    }
  }

  return { text: textParts.join('\n'), media };
}

function guessMime(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
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

export default channel;
