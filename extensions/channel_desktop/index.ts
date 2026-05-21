/** channel_desktop — AesyClaw 桌面客户端频道插件。
 *
 * 启动 WebSocket 服务器，接受 Electron 桌面客户端连接，
 * 桥接消息到 AesyClaw Pipeline 并转发流式事件。
 */

import type { ChannelPlugin, ChannelContext, StreamMessage } from '@aesyclaw/sdk';
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

    server = new DesktopServer({
      port: config.port ?? 9730,
      host: config.host ?? '127.0.0.1',
      authToken,
      adminToken,
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
 * 发送出站消息。
 *
 * 由 ChannelManager.send() 调用。消息可能是：
 * - 普通 Message：最终回复 → 作为 done 事件发送
 * - StreamMessage：流式事件 → 转发到对应桌面客户端
 */
async function send(
  sessionKey: { channel: string; type: string; chatId: string },
  message: { components: unknown[] } & { event?: string },
): Promise<void> {
  if (!server) return;

  const sessionId = sessionKey.chatId;
  const streamEvent = message as unknown as StreamMessage;

  if (streamEvent.event) {
    // 流式事件：转发到桌面客户端。
    // done 事件会在渲染端固化已收到的 chunk；最终 Message 只是持久化结果，
    // 不能再次发送，否则 desktop 会显示重复回复。
    server.forwardStreamEvent(sessionId, streamEvent);
    return;
  }

  // 非流式路径（例如命令或 hook 直接响应）才发送最终文本。
  const text = (message.components[0] as { text?: string })?.text ?? '';
  server.sendToSession(sessionId, {
    type: 'chunk',
    sessionId,
    text,
    index: 0,
  });
  server.sendToSession(sessionId, {
    type: 'done',
    sessionId,
  });
}

export default channel;
