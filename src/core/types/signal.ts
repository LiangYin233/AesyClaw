/**
 * signal — 后端→频道统一出站信号。
 *
 * 替代旧的 StreamMessage / StreamEventMeta 体系。
 * 所有出站内容平铺为单一判别联合体，频道只需 switch (signal.kind)。
 */

import type { Message, MessageUsage } from './message';
import type { SessionKey } from './identity';

// ─── Agent 实时事件 ────────────────────────────────────────────────

export type StreamChunkSignal = {
  kind: 'chunk';
  session: SessionKey;
  text: string;
  index: number;
};

export type StreamToolCallSignal = {
  kind: 'toolCall';
  session: SessionKey;
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type StreamToolResultSignal = {
  kind: 'toolResult';
  session: SessionKey;
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
};

export type StreamDoneSignal = {
  kind: 'done';
  session: SessionKey;
  usage?: MessageUsage;
};

export type StreamErrorSignal = {
  kind: 'error';
  session: SessionKey;
  message: string;
};

// ─── 完整消息 ──────────────────────────────────────────────────────

export type MessageSignal = {
  kind: 'message';
  session: SessionKey;
  content: Message;

  /** true = send_msg / hook 中间投递，false/undefined = 最终回复 */
  intermediate?: boolean;

  /** 消息来源说明，频道可按需处理 */
  source?: 'agent_send_message' | 'command' | 'hook' | 'agent_final' | 'cron';
};

// ─── 统一判别联合体 ────────────────────────────────────────────────

export type OutboundSignal =
  | StreamChunkSignal
  | StreamToolCallSignal
  | StreamToolResultSignal
  | StreamDoneSignal
  | StreamErrorSignal
  | MessageSignal;

/** 出站信号回调 */
export type OnOutboundSignal = (signal: OutboundSignal) => Promise<void> | void;
