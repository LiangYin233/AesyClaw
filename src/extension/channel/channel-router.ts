/**
 * channel-router — 频道的消息路由逻辑。
 *
 * 从 ChannelManager 中提取，专注入站接收和出站发送的消息流转。
 */

import {
  serializeSessionKey,
  type Message,
  type OutboundSignal,
  type SessionKey,
  type SenderInfo,
} from '@aesyclaw/core/types';
import type { IHooksBus } from '@aesyclaw/hook';
import type { MessageProcessor } from '@aesyclaw/contracts/pipeline';
import type { LoadedChannel } from './channel-types';

export type RouterDeps = {
  loadedChannels: Map<string, LoadedChannel>;
  hooksBus: IHooksBus;
  pipeline: MessageProcessor;
  requireLoaded(channelName: string): LoadedChannel;
};

/** 非流式频道的 chunk 缓冲区 — channel:session → 累积文本 */
export type ChunkBuffers = Map<string, string>;

export async function send(
  deps: RouterDeps,
  buffers: ChunkBuffers,
  signal: OutboundSignal,
): Promise<void> {
  const loaded = deps.requireLoaded(signal.session.channel);

  if (loaded.definition.streaming) {
    await loaded.definition.send(signal);
    return;
  }

  // 非流式频道：缓存 chunk，done 时组装+过钩子后一次性发送
  const key = `${signal.session.channel}:${serializeSessionKey(signal.session)}`;

  switch (signal.kind) {
    case 'chunk':
      if (signal.text.length > 0) {
        buffers.set(key, (buffers.get(key) ?? '') + signal.text);
      }
      return;

    case 'done': {
      const accumulated = buffers.get(key) ?? '';
      buffers.delete(key);
      if (accumulated) {
        const message: Message = { components: [{ type: 'Plain', text: accumulated }] };
        const sendCtx = { message, sessionKey: signal.session };
        const result = await deps.hooksBus.dispatch('pipeline:send', sendCtx);
        const processed: Message = result.action === 'respond' ? result.message : message;
        await loaded.definition.send({
          kind: 'message',
          session: signal.session,
          content: processed,
          intermediate: false,
        });
      }
      return;
    }

    default:
      // message / toolCall / toolResult / error — 直接转发
      await loaded.definition.send(signal);
      return;
  }
}

export async function receive(
  deps: RouterDeps,
  buffers: ChunkBuffers,
  channelName: string,
  inbound: Message,
  sessionKey: SessionKey,
  sender?: SenderInfo,
): Promise<void> {
  deps.requireLoaded(channelName);
  await deps.pipeline.receiveWithSend(inbound, sessionKey, sender, async (signal) => {
    await send(deps, buffers, signal);
  });
}

export function cleanupChunkBuffers(buffers: ChunkBuffers, channelName: string): void {
  for (const key of buffers.keys()) {
    if (key.startsWith(`${channelName}:`)) {
      buffers.delete(key);
    }
  }
}
