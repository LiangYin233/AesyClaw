import type {
  ChannelContext,
  ChannelPlugin,
  Message,
  OutboundSignal,
  SenderInfo,
  SessionKey,
} from '@aesyclaw/sdk';

import { DEFAULT_CONFIG } from './constants';
import {
  enrichMessageWithDownloads,
  enrichMessageWithReplyContent,
  extractOneBotComponents,
  mapOneBotEventToMessage,
} from './inbound';
import { sendOneBotMessage } from './outbound';
import type { OneBotChannelConfig } from './types';
import { createOneBotWebSocketClient, type OneBotWebSocketClient } from './websocket-client';
import { parseConfig } from './utils';
import { OneBotChannelConfigSchema } from './config-schema';
let context: ChannelContext | null = null;
let config: OneBotChannelConfig | null = null;
let client: OneBotWebSocketClient | null = null;
let destroyed = false;

/**
 * OneBot 渠道插件。
 * 连接到远程 OneBot/NapCat WebSocket 服务器并路由消息。
 */
export const channel: ChannelPlugin = {
  name: 'onebot',
  version: '0.1.0',
  description: 'Connects to a remote OneBot/NapCat WebSocket server and routes messages.',
  streaming: false,
  defaultConfig: DEFAULT_CONFIG,
  configSchema: OneBotChannelConfigSchema,
  async init(ctx) {
    context = ctx;
    config = parseConfig(ctx.config);
    destroyed = false;
    destroyed = false;
    client = createOneBotWebSocketClient({
      config,
      logger: ctx.logger,
      onPayload: handlePlatformPayload,
    });
    await client.start(true);
  },
  async destroy() {
    destroyed = true;
    client?.stop(new Error('OneBot channel stopped'));
    client = null;
    context?.logger.info('OneBot websocket channel stopped');
    config = null;
    context = null;
  },
  async send(signal: OutboundSignal) {
    if (!client) {
      throw new Error('OneBot channel is not initialized');
    }
    await handleOutbound(signal);
  },
};

/** 将接收到的消息注入 Pipeline（通过 ctx.receive） */
async function receiveMessage(
  message: Message,
  sessionKey: SessionKey,
  sender?: SenderInfo,
): Promise<void> {
  if (!context) {
    throw new Error('OneBot channel is not initialized');
  }
  await context.receive(message, sessionKey, sender);
}
async function handlePlatformPayload(payload: Record<string, unknown>): Promise<void> {
  const inbound = mapOneBotEventToMessage(payload, context?.name ?? 'onebot');
  if (!inbound || !context) {
    return;
  }
  const { message, sessionKey, sender } = inbound;

  if (!isChatAllowed(sessionKey, config)) {
    return;
  }
  const enrichedWithDownloads = await enrichMessageWithDownloads(
    message,
    payload,
    async (action, params) => {
      if (!client) {
        throw new Error('OneBot channel is not initialized');
      }
      return await client.sendStreamAction(action, params);
    },
    context.paths.mediaDir,
  );

  if (destroyed) {
    return;
  }

  const enrichedWithReply = await enrichMessageWithReplyContent(
    enrichedWithDownloads,
    async (action, params) => {
      if (!client) {
        throw new Error('OneBot channel is not initialized');
      }
      return await client.sendAction(action, params);
    },
  );

  if (destroyed) {
    return;
  }

  try {
    await receiveMessage(enrichedWithReply, sessionKey, sender);
  } catch (err) {
    context?.logger.error('Failed to process OneBot inbound message', err);
  }
}

/** 出站信号处理。非流式频道的 chunk/done 由 ChannelManager 统一缓存+过钩子后转为 message 发送。 */
async function handleOutbound(signal: OutboundSignal): Promise<void> {
  if (!client) return;
  if (signal.kind === 'message') {
    await sendOneBotMessage(signal.session, signal.content, client, context?.logger);
  }
}

function isChatAllowed(sessionKey: SessionKey, config: OneBotChannelConfig | null): boolean {
  const allowed = config?.allowedChats;
  if (!allowed || allowed.length === 0) return true;
  for (const entry of allowed) {
    if (entry === '*:*') return true;
    if (entry === `${sessionKey.type}:*`) return true;
    if (entry === `${sessionKey.type}:${sessionKey.chatId}`) return true;
  }
  return false;
}
export { extractOneBotComponents, mapOneBotEventToMessage, sendOneBotMessage };

export default channel;
