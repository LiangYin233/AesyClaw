import type { ChannelMessage, MessageProjection, MessageSegment, ResourceHandle } from './types.js';

export interface ProjectedCompatFile {
  name: string;
  url: string;
  localPath?: string;
  type?: 'audio' | 'video' | 'file' | 'image';
}

export interface ProjectedMessageView {
  projection: MessageProjection;
  content: string;
  media: string[];
  files: ProjectedCompatFile[];
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resourcePath(resource: ResourceHandle): string | undefined {
  return resource.localPath || resource.remoteUrl;
}

function resourcePlaceholder(label: string, resource: ResourceHandle): string {
  const value = resource.localPath || resource.originalName || resource.remoteUrl || `${label.toLowerCase()}-${resource.resourceId}`;
  return `\n[${label}: ${value}]\n`;
}

function renderSegments(segments: MessageSegment[]): string {
  const chunks: string[] = [];

  for (const segment of segments) {
    switch (segment.type) {
      case 'text':
        chunks.push(segment.text || '');
        break;
      case 'mention':
        chunks.push(segment.display ? `@${segment.display}` : `@${segment.userId}`);
        break;
      case 'quote': {
        if (!segment.message) {
          chunks.push('\n【引用消息】\n');
          break;
        }

        const quoted = renderSegments(segment.message.segments);
        chunks.push(quoted ? `\n【引用消息】\n${quoted}\n` : '\n【引用消息】\n');
        break;
      }
      case 'file':
        chunks.push(resourcePlaceholder('文件', segment.resource));
        break;
      case 'audio':
        chunks.push(resourcePlaceholder('语音', segment.resource));
        break;
      case 'video':
        chunks.push(resourcePlaceholder('视频', segment.resource));
        break;
      case 'unsupported':
        if (segment.text) {
          chunks.push(segment.text);
        }
        break;
      case 'image':
        break;
      default:
        break;
    }
  }

  return normalizeText(chunks.join(''));
}

function collectQuotedPlainText(segments: MessageSegment[]): string {
  const chunks: string[] = [];

  for (const segment of segments) {
    if (segment.type === 'quote' && segment.message) {
      const quoted = renderSegments(segment.message.segments);
      if (quoted) {
        chunks.push(quoted);
      }
    }
  }

  return normalizeText(chunks.join('\n\n'));
}

function collectResources(segments: MessageSegment[], result: {
  images: ResourceHandle[];
  files: ResourceHandle[];
}): void {
  for (const segment of segments) {
    switch (segment.type) {
      case 'image':
        result.images.push(segment.resource);
        break;
      case 'file':
      case 'audio':
      case 'video':
        result.files.push(segment.resource);
        break;
      case 'quote':
        if (segment.message) {
          collectResources(segment.message.segments, result);
        }
        break;
      default:
        break;
    }
  }
}

function mapCompatFiles(resources: ResourceHandle[]): ProjectedCompatFile[] {
  const files: ProjectedCompatFile[] = [];

  for (const resource of resources) {
    const url = resourcePath(resource);
    if (!url) {
      continue;
    }

    files.push({
      name: resource.originalName,
      url,
      localPath: resource.localPath,
      type: resource.kind
    });
  }

  return files;
}

export function projectChannelMessage(message: ChannelMessage): ProjectedMessageView {
  const resourceBuckets = {
    images: [] as ResourceHandle[],
    files: [] as ResourceHandle[]
  };
  collectResources(message.segments, resourceBuckets);

  const plainText = renderSegments(message.segments);
  const quotedPlainText = collectQuotedPlainText(message.segments);
  const projection: MessageProjection = {
    plainText,
    searchableText: plainText,
    quotedPlainText,
    visionImages: resourceBuckets.images,
    nonVisionFiles: resourceBuckets.files
  };

  return {
    projection,
    content: plainText,
    media: resourceBuckets.images
      .map(resourcePath)
      .filter((value): value is string => !!value),
    files: mapCompatFiles(resourceBuckets.files)
  };
}
