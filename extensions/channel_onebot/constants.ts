import type { MediaComponent, OneBotAttachmentType } from './types';

/** OneBot 渠道默认配置 */
export const DEFAULT_CONFIG = {
  enabled: false,
  serverUrl: 'ws://127.0.0.1:3001/',
  accessToken: '',
  allowedChats: ['*:*'],
};

/** 流式传输分块大小（64KB） */
export const STREAM_CHUNK_SIZE = 64 * 1024;
/** 流式文件保留时长（5分钟） */
export const STREAM_FILE_RETENTION_MS = 5 * 60 * 1000;

/** 附件类型到组件类型、分段类型、默认扩展名的映射 */
export const ATTACHMENT_KIND = {
  image: { componentType: 'Image', segmentType: 'image', defaultExtension: '.png' },
  audio: { componentType: 'Record', segmentType: 'record', defaultExtension: '.mp3' },
  video: { componentType: 'Video', segmentType: 'video', defaultExtension: '.mp4' },
  file: { componentType: 'File', segmentType: 'file', defaultExtension: '.bin' },
} as const satisfies Record<
  OneBotAttachmentType,
  {
    componentType: MediaComponent['type'];
    segmentType: string;
    defaultExtension: string;
  }
>;

/** 出站组件类型到 OneBot 附件类型的映射 */
export const OUTBOUND_COMPONENT_TO_ATTACHMENT_TYPE: Record<
  MediaComponent['type'],
  OneBotAttachmentType
> = {
  Image: 'image',
  Record: 'audio',
  Video: 'video',
  File: 'file',
};

/** OneBot 分段类型到附件类型的反向映射 */
export const ATTACHMENT_TYPE_BY_SEGMENT: Record<string, OneBotAttachmentType | undefined> = {
  [ATTACHMENT_KIND.image.segmentType]: 'image',
  [ATTACHMENT_KIND.audio.segmentType]: 'audio',
  [ATTACHMENT_KIND.video.segmentType]: 'video',
  [ATTACHMENT_KIND.file.segmentType]: 'file',
};

/** 聊天类型到发送 API Action 的映射 */
export const SEND_ACTION_BY_CHAT_TYPE: Record<
  string,
  { action: string; idParam: 'user_id' | 'group_id' } | undefined
> = {
  private: { action: 'send_private_msg', idParam: 'user_id' },
  group: { action: 'send_group_msg', idParam: 'group_id' },
};

/** 分段类型到下载 API Action 的映射 */
export const DOWNLOAD_REQUEST_BY_SEGMENT: Record<
  string,
  | {
      action: string;
      fallbackFileName: string;
      extraParams?: Record<string, unknown>;
    }
  | undefined
> = {
  [ATTACHMENT_KIND.image.segmentType]: {
    action: 'download_file_image_stream',
    fallbackFileName: 'image.png',
  },
  [ATTACHMENT_KIND.audio.segmentType]: {
    action: 'download_file_record_stream',
    fallbackFileName: 'audio.mp3',
    extraParams: { out_format: 'mp3' },
  },
  [ATTACHMENT_KIND.video.segmentType]: {
    action: 'download_file_stream',
    fallbackFileName: 'video.mp4',
  },
};

/** MIME 类型到文件扩展名的映射 */
export const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
};
