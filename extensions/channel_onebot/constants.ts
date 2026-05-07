import type { MediaComponent, OneBotAttachmentType } from './types';

export const DEFAULT_CONFIG = {
  enabled: false,
  serverUrl: 'ws://127.0.0.1:3001/',
  accessToken: '',
};

export const STREAM_CHUNK_SIZE = 64 * 1024;
export const STREAM_FILE_RETENTION_MS = 5 * 60 * 1000;

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

export const OUTBOUND_COMPONENT_TO_ATTACHMENT_TYPE: Record<MediaComponent['type'], OneBotAttachmentType> = {
  Image: 'image',
  Record: 'audio',
  Video: 'video',
  File: 'file',
};

export const COMPONENT_TYPE_BY_ATTACHMENT: Record<OneBotAttachmentType, MediaComponent['type']> = {
  image: ATTACHMENT_KIND.image.componentType,
  audio: ATTACHMENT_KIND.audio.componentType,
  video: ATTACHMENT_KIND.video.componentType,
  file: ATTACHMENT_KIND.file.componentType,
};

export const SEGMENT_TYPE_BY_ATTACHMENT: Record<OneBotAttachmentType, string> = {
  image: ATTACHMENT_KIND.image.segmentType,
  audio: ATTACHMENT_KIND.audio.segmentType,
  video: ATTACHMENT_KIND.video.segmentType,
  file: ATTACHMENT_KIND.file.segmentType,
};

export const DEFAULT_EXTENSION_BY_ATTACHMENT: Record<OneBotAttachmentType, string> = {
  image: ATTACHMENT_KIND.image.defaultExtension,
  audio: ATTACHMENT_KIND.audio.defaultExtension,
  video: ATTACHMENT_KIND.video.defaultExtension,
  file: ATTACHMENT_KIND.file.defaultExtension,
};

export const ATTACHMENT_TYPE_BY_SEGMENT: Record<string, OneBotAttachmentType | undefined> = {
  [ATTACHMENT_KIND.image.segmentType]: 'image',
  [ATTACHMENT_KIND.audio.segmentType]: 'audio',
  [ATTACHMENT_KIND.video.segmentType]: 'video',
  [ATTACHMENT_KIND.file.segmentType]: 'file',
};

export const SEND_ACTION_BY_CHAT_TYPE: Record<
  string,
  { action: string; idParam: 'user_id' | 'group_id' } | undefined
> = {
  private: { action: 'send_private_msg', idParam: 'user_id' },
  group: { action: 'send_group_msg', idParam: 'group_id' },
};

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
