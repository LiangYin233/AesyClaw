import { createHash } from 'crypto';
import { basename, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { copyFile, mkdir, readFile, stat, writeFile } from 'fs/promises';
import { Database } from '../../db/index.js';
import { logger } from '../../logger/index.js';
import type { ChannelMessage, MessageSegment, ResourceHandle } from './types.js';

function sanitizePathPart(value: string | undefined, fallback: string): string {
  const sanitized = (value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

async function pathExists(path: string | undefined): Promise<boolean> {
  if (!path) {
    return false;
  }

  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class ResourceStore {
  private log = logger.child({ prefix: 'ResourceStore' });

  constructor(
    private db: Database,
    readonly assetsRoot: string
  ) {}

  async ensureLocalResources(message: ChannelMessage): Promise<ChannelMessage> {
    return {
      ...message,
      segments: await this.mapSegments(message.channel, message.conversation.id, message.id, message.segments)
    };
  }

  private async mapSegments(
    channel: string,
    conversationId: string,
    messageId: string,
    segments: MessageSegment[]
  ): Promise<MessageSegment[]> {
    const mapped: MessageSegment[] = [];

    for (const segment of segments) {
      switch (segment.type) {
        case 'image':
        case 'file':
        case 'audio':
        case 'video':
          mapped.push({
            ...segment,
            resource: await this.ensureResourceLocal(channel, conversationId, messageId, segment.resource)
          });
          break;
        case 'quote':
          mapped.push({
            ...segment,
            message: segment.message
              ? {
                  ...segment.message,
                  segments: await this.mapSegments(
                    segment.message.channel,
                    segment.message.conversation.id,
                    segment.message.id,
                    segment.message.segments
                  )
                }
              : undefined
          });
          break;
        default:
          mapped.push(segment);
          break;
      }
    }

    return mapped;
  }

  private async ensureResourceLocal(
    channel: string,
    conversationId: string,
    messageId: string,
    resource: ResourceHandle
  ): Promise<ResourceHandle> {
    const resourceRecordId = `${channel}:${conversationId}:${messageId}:${resource.resourceId}`;
    const sourceLocalPath = this.resolveSourceLocalPath(resource);
    const targetDir = join(
      this.assetsRoot,
      sanitizePathPart(channel, 'channel'),
      sanitizePathPart(conversationId, 'conversation'),
      sanitizePathPart(messageId, 'message')
    );
    await mkdir(targetDir, { recursive: true });

    const targetName = `${sanitizePathPart(resource.resourceId, 'resource')}-${sanitizePathPart(this.resolveFileName(resource), `${resource.kind}`)}`;
    const targetPath = join(targetDir, targetName);

    let finalPath = resource.localPath;
    let size = resource.size;
    let sha256 = resource.sha256;

    try {
      if (sourceLocalPath && await pathExists(sourceLocalPath)) {
        const resolvedSource = resolve(sourceLocalPath);
        const resolvedTarget = resolve(targetPath);
        if (resolvedSource !== resolvedTarget) {
          await copyFile(resolvedSource, resolvedTarget);
        }

        const buffer = await readFile(resolvedTarget);
        size = buffer.length;
        sha256 = createHash('sha256').update(buffer).digest('hex');
        finalPath = resolvedTarget;
      } else if (resource.remoteUrl && isHttpUrl(resource.remoteUrl)) {
        const response = await fetch(resource.remoteUrl, {
          headers: resource.downloadHeaders
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(targetPath, buffer);
        size = buffer.length;
        sha256 = createHash('sha256').update(buffer).digest('hex');
        finalPath = targetPath;
      }
    } catch (error) {
      this.log.warn('Resource localization failed', {
        channel,
        conversationId,
        messageId,
        resourceId: resource.resourceId,
        kind: resource.kind,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const hydrated: ResourceHandle = {
      ...resource,
      localPath: finalPath,
      size,
      sha256
    };

    await this.db.run(
      `INSERT INTO channel_resources (
         id, channel, conversation_id, message_id, kind, original_name,
         mime_type, size, remote_url, platform_file_id, local_path, sha256, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         mime_type = excluded.mime_type,
         size = excluded.size,
         remote_url = excluded.remote_url,
         platform_file_id = excluded.platform_file_id,
         local_path = excluded.local_path,
         sha256 = excluded.sha256,
         updated_at = CURRENT_TIMESTAMP`,
      [
        resourceRecordId,
        channel,
        conversationId,
        messageId,
        resource.kind,
        resource.originalName,
        resource.mimeType || null,
        size || null,
        resource.remoteUrl || null,
        resource.platformFileId || null,
        finalPath || null,
        sha256 || null
      ]
    );

    return hydrated;
  }

  private resolveSourceLocalPath(resource: ResourceHandle): string | undefined {
    const candidate = resource.localPath || resource.remoteUrl;
    if (!candidate) {
      return undefined;
    }

    if (candidate.startsWith('file://')) {
      return fileURLToPath(candidate);
    }

    if (candidate.startsWith('/') || candidate.startsWith('./') || candidate.startsWith('../')) {
      return resolve(candidate);
    }

    if (/^[A-Za-z]:[\\/]/.test(candidate)) {
      return candidate;
    }

    return undefined;
  }

  private resolveFileName(resource: ResourceHandle): string {
    if (resource.originalName) {
      return basename(resource.originalName);
    }

    const source = resource.localPath || resource.remoteUrl || `${resource.kind}-${resource.resourceId}`;
    if (source.startsWith('file://')) {
      return basename(fileURLToPath(source));
    }

    return basename(source) || `${resource.kind}-${resource.resourceId}`;
  }
}
