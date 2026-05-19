/** 流式事件类型 — Agent 执行过程中产出的中间事件。
 *
 * 通过 Agent.subscribe() 捕获 pi-agent-core 生命周期事件，
 * 转换为统一的 StreamEvent，经 Pipeline → Channel.send() 推给客户端。
 */

import type { Message } from './message-types';

// ─── 流式事件判别 ──────────────────────────────────────────────────

export type StreamEventType = 'chunk' | 'toolCall' | 'toolResult' | 'done' | 'error';

export type StreamUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

// ─── 流式消息（扩展 Message） ──────────────────────────────────────

/**
 * 流式事件消息。在普通 Message 上附加 `event` 字段区分事件类型。
 *
 * - chunk:       LLM 产出的文本增量，文本放在 components[0] (Plain text)
 * - toolCall:    工具开始调用，toolName/toolCallId/args 描述调用
 * - toolResult:  工具执行结果，content/details/isError 描述结果
 * - done:        本轮 Agent 处理结束
 * - error:       处理过程中出错
 */
export type StreamMessage = Message & {
  event: StreamEventType;
  // chunk 无需额外字段，文本在 components 中
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  errorMessage?: string;
  /** 文本块的序号，从 0 递增，供前端按序拼接 */
  chunkIndex?: number;
  /** 本轮最终 assistant 消息的 token/cost 用量，仅 done 事件携带 */
  usage?: StreamUsage;
};

// ─── 流式事件回调 ──────────────────────────────────────────────────

/** Agent 过程产出的流式事件回调 */
export type OnStreamEvent = (event: StreamMessage) => Promise<void> | void;

// ─── pi-agent-core 事件映射 ────────────────────────────────────────

/** 流式事件元数据。从 AgentEvent 转换而来 */
export type StreamEventMeta = {
  type: 'chunk' | 'toolCall' | 'toolResult' | 'done';
  /** chunk 类型时: 增量文本 */
  text?: string;
  /** 文本块序号 */
  chunkIndex?: number;
  /** toolCall/toolResult: 工具调用 ID */
  toolCallId?: string;
  /** toolCall/toolResult: 工具名称 */
  toolName?: string;
  /** toolCall: 参数 */
  args?: unknown;
  /** toolResult: 执行结果 */
  result?: unknown;
  /** toolResult: 是否出错 */
  isError?: boolean;
  /** done 类型时: 最终 assistant 消息的 token/cost 用量 */
  usage?: StreamUsage;
};
