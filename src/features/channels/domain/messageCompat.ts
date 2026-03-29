import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { InboundMessage, OutboundMessage } from '../../../types.js';
import { createShortId } from '../../../platform/utils/createShortId.js';
import type { ChannelMessage } from './types.js';
import type { MessageSegment, ResourceHandle } from './types.js';
import { projectChannelMessage } from './projection.js';

function restoreLiteralNewlines(text: string): string {
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');
}

function detectFileType(fileName: string): 'audio' | 'video' | 'image' | 'file' {
  const ext = fileName.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (!ext) {
    return 'file';
  }

  if (['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'amr', 'aac', 'wma'].includes(ext)) {
    return 'audio';
  }

  if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg'].includes(ext)) {
    return 'video';
  }

  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext)) {
    return 'image';
  }

  return 'file';
}

function makeResource(kind: ResourceHandle['kind'], input: string): ResourceHandle {
  const resourceId = createShortId();
  const fileName = basename(input.replace(/^file:\/\//, '')) || `${kind}-${resourceId}`;
  const isRemote = input.startsWith('http://') || input.startsWith('https://') || input.startsWith('file://');

  return {
    resourceId,
    kind,
    originalName: fileName,
    remoteUrl: isRemote ? input : undefined,
    localPath: isRemote ? undefined : input
  };
}

function normalizeOutboundSegments(segments: MessageSegment[]): MessageSegment[] {
  return segments.map((segment) => {
    if (segment.type === 'text') {
      return {
        ...segment,
        text: restoreLiteralNewlines(segment.text)
      };
    }

    if (segment.type === 'quote' && segment.message) {
      return {
        ...segment,
        message: {
          ...segment.message,
          segments: normalizeOutboundSegments(segment.message.segments)
        }
      };
    }

    return segment;
  });
}

export function mapCompatOutboundToChannelMessage(message: OutboundMessage): ChannelMessage {
  const segments: MessageSegment[] = [];

  if (message.replyTo) {
    segments.push({
      type: 'quote',
      reference: { platformMessageId: message.replyTo }
    });
  }

  if (Array.isArray(message.segments) && message.segments.length > 0) {
    segments.push(...normalizeOutboundSegments(message.segments));
  } else {
    if (message.content) {
      segments.push({
        type: 'text',
        text: restoreLiteralNewlines(message.content)
      });
    }

    for (const media of message.media || []) {
      segments.push({
        type: 'image',
        resource: makeResource('image', media)
      });
    }

    for (const file of message.files || []) {
      const kind = detectFileType(file);
      const resource = makeResource(kind === 'image' ? 'file' : kind, file);
      if (kind === 'audio') {
        segments.push({ type: 'audio', resource });
      } else if (kind === 'video') {
        segments.push({ type: 'video', resource });
      } else {
        segments.push({ type: 'file', resource: { ...resource, kind: 'file' } });
      }
    }
  }

  return {
    id: message.id || randomUUID(),
    channel: message.channel,
    direction: 'outbound',
    conversation: message.conversation || {
      id: message.chatId,
      type: message.messageType || 'private'
    },
    sender: message.sender,
    timestamp: new Date(),
    platformMessageId: message.platformMessageId,
    segments,
    metadata: {
      ...message.metadata,
      reasoning_content: message.reasoning_content,
      idempotencyKey: message.idempotencyKey || message.metadata?.idempotencyKey
    }
  };
}

export function mapChannelMessageToCompatInbound(message: ChannelMessage): InboundMessage {
  const projected = projectChannelMessage(message);

  return {
    id: message.id,
    channel: message.channel,
    senderId: message.sender?.id || message.conversation.id,
    chatId: message.conversation.id,
    content: projected.content,
    rawEvent: message.rawEvent,
    timestamp: message.timestamp,
    messageId: message.platformMessageId || message.id,
    media: projected.media.length > 0 ? projected.media : undefined,
    files: projected.files.length > 0 ? projected.files : undefined,
    messageType: message.conversation.type,
    metadata: message.metadata,
    segments: message.segments,
    projection: projected.projection,
    conversation: message.conversation,
    sender: message.sender,
    direction: message.direction,
    platformMessageId: message.platformMessageId
  };
}
