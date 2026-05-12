import type {
  ChannelContext,
  FileComponent,
  ImageComponent,
  MessageComponent,
  RecordComponent,
  VideoComponent,
} from '@aesyclaw/sdk';

/** OneBot 支持的附件类型 */
export type OneBotAttachmentType = 'image' | 'audio' | 'video' | 'file';

/** 附件下载结果 */
export type OneBotDownloadResult = {
  type: OneBotAttachmentType;
  path?: string;
  url?: string;
};

/** 媒体消息组件联合类型（Image | Record | Video | File） */
export type MediaComponent = ImageComponent | RecordComponent | VideoComponent | FileComponent;

/** OneBot 渠道配置 */
export type OneBotChannelConfig = {
  serverUrl: string;
  accessToken?: string;
  allowedChats?: string[];
};

/** OneBot 日志记录器类型 */
export type OneBotLogger = ChannelContext['logger'];

/** 加载后的附件源数据 */
export type LoadedAttachmentSource = {
  data: Uint8Array;
  fileName: string;
};

/** 上传后的附件信息 */
export type UploadedAttachment = {
  filePath: string;
  fileName: string;
};

/** OneBot 消息分段 */
export type OneBotMessageSegment = {
  type: string;
  data: Record<string, unknown>;
};

/** 流式下载文件结果 */
export type DownloadedStreamFile = {
  data: Uint8Array;
  fileName: string;
};

/** OneBot 入站附件分段信息 */
export type OneBotInboundAttachmentSegment = {
  attachmentType: OneBotAttachmentType;
  componentType: Extract<MessageComponent['type'], 'Image' | 'Record' | 'Video' | 'File'>;
  segmentType: string;
  data: Record<string, unknown>;
};
