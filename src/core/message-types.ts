/** 消息类型 — 纯消息载荷、组件及持久化协议。 */

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

export type ImageComponent = {
  type: 'Image';
  url?: string;
  path?: string;
  file?: string;
  base64?: string;
  mimeType?: string;
};

export type RecordComponent = {
  type: 'Record';
  url?: string;
  path?: string;
  file?: string;
  base64?: string;
  mimeType?: string;
};

export type VideoComponent = {
  type: 'Video';
  url?: string;
  path?: string;
  file?: string;
  base64?: string;
  mimeType?: string;
};

export type FileComponent = {
  type: 'File';
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

export type MessageComponent =
  | PlainComponent
  | ImageComponent
  | RecordComponent
  | VideoComponent
  | FileComponent
  | ReplyComponent
  | UnknownComponent;

/** 纯消息载荷：只表示消息本身，不携带会话、发送者上下文。 */
export type Message<TComponent = MessageComponent> = {
  components: TComponent[];
};

// ─── 入站消息 ──────────────────────────────────────────────────

/** 从外部平台进入管道的传入消息 */
export type InboundMessage = Message<MessageComponent>;

export function getMessageText(message: Pick<Message<{ type: string; text?: unknown }>, 'components'>): string {
  return message.components
    .filter((component): component is PlainComponent => component.type === 'Plain' && typeof component.text === 'string')
    .map((component) => component.text)
    .join('');
}

// ─── 出站消息 ──────────────────────────────────────────────────

/** 由管道生成并通过频道发送回去的回复 */
export type OutboundMessage = Message<MessageComponent>;

/** 通过频道发送传出消息的函数 */
export type SendFn = (message: OutboundMessage) => Promise<void>;

/** 消息经过管道或钩子处理后的结果 */
export type PipelineResult =
  | { action: 'continue'; data?: unknown }
  | { action: 'block'; reason?: string }
  | { action: 'respond'; components: MessageComponent[] };

// ─── 持久化 ────────────────────────────────────────────────────────

/** 持久化到数据库的消息记录 */
export type PersistableMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
};
