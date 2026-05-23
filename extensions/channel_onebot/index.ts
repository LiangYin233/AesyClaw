import type { ChannelContext, ChannelPlugin, Message, SenderInfo, SessionKey } from '@aesyclaw/sdk';
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
/** 流式输出缓冲区 — 按 chatId 累积 chunk 文本，收到 done 后一次性发送。 */
const streamBuffers = new Map<string, string>();

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
  async send(sessionKey, message) {
    if (!client) {
      throw new Error('OneBot channel is not initialized');
    }
    await handleOutbound(sessionKey, message);
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
 * 出站消息处理。流式事件缓冲后一次性发送，非流式消息直接发送。
 */
async function handleOutbound(sessionKey: SessionKey, message: Message): Promise<void> {
  const chatId = sessionKey.chatId;

  // 流式事件：缓冲 chunk，done 时一次性发送
  if ('event' in message) {
    const ev = (message as Record<string, unknown>)['event'] as string | undefined;
    if (ev === 'chunk') {
      const text = (message.components[0] as { text?: string } | undefined)?.text ?? '';
      if (text) {
        streamBuffers.set(chatId, (streamBuffers.get(chatId) ?? '') + text);
      }
      return;
    }
    if (ev === 'done') {
      const accumulated = streamBuffers.get(chatId) ?? '';
      streamBuffers.delete(chatId);
      if (accumulated) {
        await sendOneBotMessage(
          sessionKey,
          { components: [{ type: 'Plain', text: accumulated }] },
          client!,
          context?.logger,
        );
      }
      return;
    }
    // toolCall / toolResult / error — onebot 不关心，忽略
    return;
  }

  // 非流式消息（命令 / send_msg 中间投递）
  await sendOneBotMessage(sessionKey, message, client!, context?.logger);
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
