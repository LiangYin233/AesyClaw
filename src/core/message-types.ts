import type { SessionKey } from './identity-types';

/** Media attachment carried alongside a message */
export interface MediaAttachment {
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  path?: string;
  base64?: string;
  mimeType?: string;
}

/** Information about the message sender */
export interface SenderInfo {
  id: string;
  name?: string;
  role?: string;
}

/** Message arriving from an external platform into the pipeline */
export interface InboundMessage {
  sessionKey: SessionKey;
  content: string;
  attachments?: MediaAttachment[];
  sender?: SenderInfo;
  rawEvent?: unknown;
}

/** Reply produced by the pipeline and sent back through a channel */
export interface OutboundMessage {
  content: string;
  attachments?: MediaAttachment[];
}

/** Function that sends an outbound message through a channel */
export type SendFn = (message: OutboundMessage) => Promise<void>;

/** Result of processing a message through the pipeline or a hook */
export type PipelineResult =
  | { action: 'continue'; data?: unknown }
  | { action: 'block'; reason?: string }
  | { action: 'respond'; content: string; attachments?: MediaAttachment[] };

/** Message record persisted in the database */
export interface PersistableMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}
