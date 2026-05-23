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

let context: ChannelContext | null = null;
let config: OneBotChannelConfig | null = null;
let client: OneBotWebSocketClient | null = null;
let destroyed = false;
/** 流式输出缓冲区 — 按 channel:type:chatId 累积 chunk 文本，收到 done 后一次性发送。 */
const streamBuffers = new Map<string, string>();

function streamBufferKey(sessionKey: SessionKey): string {
  return `${sessionKey.channel}:${sessionKey.type}:${sessionKey.chatId}`;
}

/**
 * OneBot 渠道插件。
 * 连接到远程 OneBot/NapCat WebSocket 服务器并路由消息。
 */
export const channel: ChannelPlugin = {
  name: 'onebot',
  version: '0.1.0',
  description: 'Connects to a remote OneBot/NapCat WebSocket server and routes messages.',
  defaultConfig: DEFAULT_CONFIG,
  async init(ctx) {
    context = ctx;
    config = parseConfig(ctx.config);
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
  receive: receiveMessage,
};

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

/**
 * 出站信号处理。流式事件缓冲后一次性发送，message 直接发送。
 */
async function handleOutbound(signal: OutboundSignal): Promise<void> {
  if (!client) return;
  const key = streamBufferKey(signal.session);

  switch (signal.kind) {
    case 'chunk':
      if (signal.text.length > 0) {
        streamBuffers.set(key, (streamBuffers.get(key) ?? '') + signal.text);
      }
      return;

    case 'done': {
      const accumulated = streamBuffers.get(key) ?? '';
      streamBuffers.delete(key);
      if (accumulated) {
        await sendOneBotMessage(
          signal.session,
          { components: [{ type: 'Plain', text: accumulated }] },
          client,
          context?.logger,
        );
      }
      return;
    }

    case 'message':
      await sendOneBotMessage(signal.session, signal.content, client, context?.logger);
      return;

    // toolCall / toolResult / error — onebot 不关心，忽略
    case 'toolCall':
    case 'toolResult':
    case 'error':
      return;
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
