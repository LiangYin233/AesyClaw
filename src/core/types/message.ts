/** 消息类型 — 纯消息载荷、组件及持久化协议。 */
import { isRecord } from '../utils';
import type { OutboundSignal } from './signal';

// ─── 发送者 ─────────────────────────────────────────────────

/** 消息发送者信息 */
export type SenderInfo = {
  id: string;
  name?: string;
  role?: string;
};

// ─── 消息载荷与组件 ─────────────────────────────────────────────────

export type PlainComponent = {
  type: 'Plain';
  text: string;
};
export type MediaComponent = {
  type: 'Image' | 'Record' | 'Video' | 'File';
  url?: string;
  path?: string;
  file?: string;
  fileId?: string;
  name?: string;
  base64?: string;
  mimeType?: string;
};
export type ReplyComponent = {
  type: 'Reply';
  components: MessageComponent[];
  sender?: SenderInfo;
  id?: string;
};

export type UnknownComponent = {
  type: 'Unknown';
  segmentType?: string;
  data?: Record<string, unknown>;
};

export type MessageComponent = PlainComponent | MediaComponent | ReplyComponent | UnknownComponent;

/** 纯消息载荷：只表示消息本身，不携带会话、发送者上下文。 */
export type Message = {
  components: MessageComponent[];
};

/**
 * 从消息中提取所有纯文本组件的内容并拼接为字符串。
 *
 * @param message - 包含 components 属性的消息对象
 * @returns 拼接后的纯文本
 */
export function getMessageText(message: Pick<Message, 'components'>): string {
  return message.components
    .filter(
      (component): component is PlainComponent =>
        component.type === 'Plain' && typeof component.text === 'string',
    )
    .map((component) => component.text)
    .join('');
}

/** 出站信号投递函数，由 pipeline 内部使用 */
export type SendFn = (signal: OutboundSignal) => Promise<void>;

// ─── 持久化 ────────────────────────────────────────────────────────

export type MessageUsage = {
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

export type MessageUsageCost = NonNullable<MessageUsage['cost']>;
export type CompleteMessageUsage = MessageUsage & { cost: MessageUsageCost };

export function createZeroMessageUsage(): CompleteMessageUsage {
  return completeMessageUsage();
}

export function completeMessageUsage(usage?: MessageUsage): CompleteMessageUsage {
  return {
    input: usage?.input ?? 0,
    output: usage?.output ?? 0,
    cacheRead: usage?.cacheRead ?? 0,
    cacheWrite: usage?.cacheWrite ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cost: {
      input: usage?.cost?.input ?? 0,
      output: usage?.cost?.output ?? 0,
      cacheRead: usage?.cost?.cacheRead ?? 0,
      cacheWrite: usage?.cost?.cacheWrite ?? 0,
      total: usage?.cost?.total ?? 0,
    },
  };
}

export function parseMessageUsageJson(value: string): MessageUsage | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isMessageUsage(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function isMessageUsage(value: unknown): value is MessageUsage {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value['input']) &&
    isFiniteNumber(value['output']) &&
    isFiniteNumber(value['cacheRead']) &&
    isFiniteNumber(value['cacheWrite']) &&
    isFiniteNumber(value['totalTokens']) &&
    (value['cost'] === undefined || isMessageUsageCost(value['cost']))
  );
}

function isMessageUsageCost(value: unknown): value is MessageUsageCost {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value['input']) &&
    isFiniteNumber(value['output']) &&
    isFiniteNumber(value['cacheRead']) &&
    isFiniteNumber(value['cacheWrite']) &&
    isFiniteNumber(value['total'])
  );
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 持久化到数据库的消息记录 */
export type PersistableMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  usage?: MessageUsage;
};
