export type ResourceKind = 'image' | 'file' | 'audio' | 'video';

export interface ResourceHandle {
  resourceId: string;
  kind: ResourceKind;
  originalName: string;
  mimeType?: string;
  size?: number;
  remoteUrl?: string;
  downloadHeaders?: Record<string, string>;
  platformFileId?: string;
  localPath?: string;
  sha256?: string;
}

export interface ChannelConversation {
  id: string;
  type: 'private' | 'group';
  title?: string;
}

export interface ChannelSender {
  id: string;
  displayName?: string;
  isSelf?: boolean;
}

export interface QuoteReference {
  platformMessageId?: string;
  messageId?: string;
}

export interface TextSegment {
  type: 'text';
  text: string;
}

export interface MentionSegment {
  type: 'mention';
  userId: string;
  display?: string;
}

export interface QuoteSegment {
  type: 'quote';
  reference: QuoteReference;
  message?: ChannelMessage;
}

export interface ImageSegment {
  type: 'image';
  resource: ResourceHandle;
}

export interface FileSegment {
  type: 'file';
  resource: ResourceHandle;
}

export interface AudioSegment {
  type: 'audio';
  resource: ResourceHandle;
}

export interface VideoSegment {
  type: 'video';
  resource: ResourceHandle;
}

export interface UnsupportedSegment {
  type: 'unsupported';
  originalType: string;
  text?: string;
}

export type MessageSegment =
  | TextSegment
  | MentionSegment
  | QuoteSegment
  | ImageSegment
  | FileSegment
  | AudioSegment
  | VideoSegment
  | UnsupportedSegment;

export interface MessageProjection {
  plainText: string;
  searchableText: string;
  quotedPlainText: string;
  visionImages: ResourceHandle[];
  nonVisionFiles: ResourceHandle[];
}

export interface ChannelMessage {
  id: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  conversation: ChannelConversation;
  sender?: ChannelSender;
  timestamp: Date;
  platformMessageId?: string;
  segments: MessageSegment[];
  metadata?: Record<string, any>;
  rawEvent?: any;
  projection?: MessageProjection;
}

export interface ChannelCapabilityProfile {
  supportsMentions?: boolean;
  supportsQuotes?: boolean;
  supportsImages?: boolean;
  supportsFiles?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  maxTextLength?: number;
}

export interface AdapterInboundDraft {
  conversation: ChannelConversation;
  sender: ChannelSender;
  timestamp?: Date;
  platformMessageId?: string;
  segments: MessageSegment[];
  metadata?: Record<string, any>;
  rawEvent?: any;
}

export interface AdapterSendResult {
  platformMessageId?: string;
  raw?: any;
}

export interface DeliveryReceipt {
  jobId: string;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  attempts: number;
  retryable: boolean;
  platformMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}
