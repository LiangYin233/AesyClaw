import type {
  ChannelContext,
  FileComponent,
  ImageComponent,
  MessageComponent,
  RecordComponent,
  VideoComponent,
} from '@aesyclaw/sdk';
import type { WebSocketLike } from './websocket-client';

export type OneBotAttachmentType = 'image' | 'audio' | 'video' | 'file';

export type OneBotDownloadResult = {
  type: OneBotAttachmentType;
  path?: string;
  url?: string;
};

export type MediaComponent =
  | ImageComponent
  | RecordComponent
  | VideoComponent
  | FileComponent;

export type OneBotChannelConfig = {
  serverUrl: string;
  accessToken?: string;
};

export type OneBotLogger = ChannelContext['logger'];

export type LoadedAttachmentSource = {
  data: Uint8Array;
  fileName: string;
};

export type UploadedAttachment = {
  filePath: string;
  fileName: string;
};

export type OneBotMessageSegment = {
  type: string;
  data: Record<string, unknown>;
};

export type DownloadedStreamFile = {
  data: Uint8Array;
  fileName: string;
};

export type OneBotInboundAttachmentSegment = {
  attachmentType: OneBotAttachmentType;
  componentType: Extract<MessageComponent['type'], 'Image' | 'Record' | 'Video' | 'File'>;
  segmentType: string;
  data: Record<string, unknown>;
};

export type CreateOneBotChannelOptions = {
  createSocket?: (url: string) => WebSocketLike;
};
