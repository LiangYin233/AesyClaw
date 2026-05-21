import type { MessageComponent } from '@aesyclaw/sdk';
import type { DesktopReceivedFile } from './types';

export function sanitizeFileName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\p{C}/gu, '_')
    .trim();
  return sanitized.length > 0 ? sanitized : 'upload.bin';
}

export function sanitizePathSegment(segment: string): string {
  const sanitized = segment.replace(/[^a-z0-9._-]/gi, '_').trim();
  return sanitized.length > 0 ? sanitized : 'session';
}

function fileComponentType(mime: string): 'Image' | 'Record' | 'Video' | 'File' {
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('audio/')) return 'Record';
  if (mime.startsWith('video/')) return 'Video';
  return 'File';
}

function attachmentKind(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export function fileToMessageComponent(file: DesktopReceivedFile): MessageComponent {
  const type = fileComponentType(file.mime);
  return {
    type,
    ['path']: file.filePath,
    file: file.name,
    name: file.name,
    mimeType: file.mime,
  } as MessageComponent;
}

export function formatAttachmentText(attachments: DesktopReceivedFile[]): string {
  if (attachments.length === 0) return '';
  return [
    '[Attachments]',
    ...attachments.map(
      (file) => `- ${attachmentKind(file.mime)}: ${file.filePath} (${file.name}, ${file.mime})`,
    ),
  ].join('\n');
}
