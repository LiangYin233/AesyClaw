/** 消息类型 — 管道入口/出口、附件、发送者信息及持久化协议。 */

import type { SessionKey } from './identity-types';

// ─── 附件与发送者 ─────────────────────────────────────────────────

/** 随消息一起携带的媒体附件 */
export type MediaAttachment = {
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  path?: string;
  base64?: string;
  mimeType?: string;
};

/** 消息发送者信息 */
export type SenderInfo = {
  id: string;
  name?: string;
  role?: string;
};

// ─── 传入消息组件 ─────────────────────────────────────────────────

export type PlainComponent = {
  type: 'Plain';
  text: string;
};

export type ImageComponent = {
  type: 'Image';
  url?: string;
  path?: string;
  file?: string;
};

export type RecordComponent = {
  type: 'Record';
  url?: string;
  path?: string;
  file?: string;
};

export type VideoComponent = {
  type: 'Video';
  url?: string;
  path?: string;
  file?: string;
};

export type FileComponent = {
  type: 'File';
  url?: string;
  path?: string;
  file?: string;
  fileId?: string;
  name?: string;
};

export type FaceComponent = {
  type: 'Face';
  id?: string;
};

export type AtComponent = {
  type: 'At';
  qq?: string;
};

export type ReplyComponent = {
  type: 'Reply';
  id?: string;
};

export type ForwardComponent = {
  type: 'Forward';
  id?: string;
};

export type NodeComponent = {
  type: 'Node';
  data?: Record<string, unknown>;
};

export type NodesComponent = {
  type: 'Nodes';
  nodes?: NodeComponent[];
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
  | FaceComponent
  | AtComponent
  | ReplyComponent
  | ForwardComponent
  | NodeComponent
  | NodesComponent
  | UnknownComponent;

// ─── 入口 / 出口 / 管道 ────────────────────────────────────────────

/** 从外部平台进入管道的传入消息 */
export type InboundMessage = {
  sessionKey: SessionKey;
  components: MessageComponent[];
  sender?: SenderInfo;
  rawEvent?: unknown;
};

export function getInboundMessageText(message: Pick<InboundMessage, 'components'>): string {
  return message.components
    .filter((component): component is PlainComponent => component.type === 'Plain')
    .map((component) => component.text)
    .join('');
}

/** 由管道生成并通过频道发送回去的回复 */
export type OutboundMessage = {
  content: string;
  attachments?: MediaAttachment[];
};

/** 通过频道发送传出消息的函数 */
export type SendFn = (message: OutboundMessage) => Promise<void>;

/** 消息经过管道或钩子处理后的结果 */
export type PipelineResult =
  | { action: 'continue'; data?: unknown }
  | { action: 'block'; reason?: string }
  | { action: 'respond'; content: string; attachments?: MediaAttachment[] };

// ─── 持久化 ────────────────────────────────────────────────────────

/** 持久化到数据库的消息记录 */
export type PersistableMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
};
