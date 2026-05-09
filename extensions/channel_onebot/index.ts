import type {
  ChannelContext,
  ChannelPlugin,
  Message,
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
    await sendOneBotMessage(sessionKey, message, client, context?.logger);
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

export { extractOneBotComponents, mapOneBotEventToMessage, sendOneBotMessage };

export default channel;
