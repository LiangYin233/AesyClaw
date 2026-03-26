import { createHash } from 'crypto';
import { basename, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { copyFile, mkdir, readFile, stat, writeFile } from 'fs/promises';
import { Database } from '../../../platform/db/index.js';
import { logger } from '../../../platform/observability/index.js';
import { formatLocalTimestamp } from '../../../platform/observability/logging.js';
import type { ChannelMessage, MessageSegment, ResourceHandle } from '../domain/types.js';

type ResourceResolver = (resource: ResourceHandle, rawEvent?: unknown) => Promise<ResourceHandle | null>;

function sanitizePathPart(value: string | undefined, fallback: string): string {
  const sanitized = (value || fallback)
    .split('')
    .map((char) => (char < ' ' || /[<>:"/\\|?*]/.test(char) ? '_' : char))
    .join('')
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
  private log = logger.child('ResourceStore');

  constructor(
    private db: Database,
    readonly assetsRoot: string
  ) {}

  async ensureLocalResources(message: ChannelMessage, resolveResource?: ResourceResolver): Promise<ChannelMessage> {
    return {
      ...message,
      segments: await this.mapSegments(
        message.channel,
        message.conversation.id,
        message.id,
        message.segments,
        message.rawEvent,
        resolveResource
      )
    };
  }

  private async mapSegments(
    channel: string,
    conversationId: string,
    messageId: string,
    segments: MessageSegment[],
    rawEvent?: unknown,
    resolveResource?: ResourceResolver
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
            resource: await this.ensureResourceLocal(
              channel,
              conversationId,
              messageId,
              segment.resource,
              rawEvent,
              resolveResource
            )
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
                    segment.message.segments,
                    segment.message.rawEvent,
                    resolveResource
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
    resource: ResourceHandle,
    rawEvent?: unknown,
    resolveResource?: ResourceResolver
  ): Promise<ResourceHandle> {
    const resolvedResource = await this.resolveResource(resource, rawEvent, resolveResource);
    const effectiveResource = resolvedResource ?? resource;
    const resourceRecordId = `${channel}:${conversationId}:${messageId}:${resource.resourceId}`;
    const sourceLocalPath = this.resolveSourceLocalPath(effectiveResource);
    const targetDir = join(
      this.assetsRoot,
      sanitizePathPart(channel, 'channel'),
      sanitizePathPart(conversationId, 'conversation'),
      sanitizePathPart(messageId, 'message')
    );
    await mkdir(targetDir, { recursive: true });

    const targetName = `${sanitizePathPart(resource.resourceId, 'resource')}-${sanitizePathPart(this.resolveFileName(effectiveResource), `${resource.kind}`)}`;
    const targetPath = join(targetDir, targetName);

    let finalPath = effectiveResource.localPath;
    let size = effectiveResource.size;
    let sha256 = effectiveResource.sha256;

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
      } else if (effectiveResource.remoteUrl && isHttpUrl(effectiveResource.remoteUrl)) {
        const response = await fetch(effectiveResource.remoteUrl, {
          headers: effectiveResource.downloadHeaders
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
    } catch {
    }

    const hydrated: ResourceHandle = {
      ...effectiveResource,
      resourceId: resource.resourceId,
      localPath: finalPath,
      size,
      sha256
    };

    const now = formatLocalTimestamp(new Date());

    await this.db.run(
      `INSERT INTO channel_resources (
         id, channel, conversation_id, message_id, kind, original_name,
         mime_type, size, remote_url, platform_file_id, local_path, sha256, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mime_type = excluded.mime_type,
         size = excluded.size,
         remote_url = excluded.remote_url,
         platform_file_id = excluded.platform_file_id,
         local_path = excluded.local_path,
         sha256 = excluded.sha256,
         updated_at = excluded.updated_at`,
      [
        resourceRecordId,
        channel,
        conversationId,
        messageId,
        resource.kind,
        hydrated.originalName,
        hydrated.mimeType || null,
        size || null,
        hydrated.remoteUrl || null,
        hydrated.platformFileId || null,
        finalPath || null,
        sha256 || null,
        now,
        now
      ]
    );

    return hydrated;
  }

  private async resolveResource(
    resource: ResourceHandle,
    rawEvent: unknown,
    resolveResource?: ResourceResolver
  ): Promise<ResourceHandle | null> {
    if (!resolveResource || resource.localPath || resource.remoteUrl || !resource.platformFileId) {
      return resource;
    }

    try {
      const resolved = await resolveResource(resource, rawEvent);
      if (!resolved) {
        return resource;
      }

      return {
        ...resource,
        ...resolved,
        resourceId: resource.resourceId,
        kind: resource.kind
      };
    } catch {
      return resource;
    }
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
