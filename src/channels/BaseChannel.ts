import type { InboundMessage, InboundFile, OutboundMessage } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';
import { mkdir, writeFile } from 'fs/promises';
import { join, basename } from 'path';

/**
 * Parsed message data from platform-specific format
 */
export interface ParsedMessage {
  content: string;
  media?: string[];
  files?: InboundFile[];
}

/**
 * Base Channel Adapter
 *
 * Provides standardized middleware for channel implementations:
 * 1. Message reception pipeline: validate → parse → download → publish
 * 2. Message sending pipeline: validate → format → send
 * 3. Permission control
 * 4. File handling
 *
 * Subclasses only need to implement platform-specific details:
 * - Connection management (start/stop)
 * - Message sending (send)
 * - Message parsing (parseMessage)
 */
export abstract class BaseChannel {
  abstract readonly name: string;
  protected config: any;
  protected eventBus: EventBus;
  protected workspace: string;
  protected running = false;
  protected log = logger;

  constructor(config: any, eventBus: EventBus, workspace?: string) {
    this.config = config;
    this.eventBus = eventBus;
    this.workspace = workspace || process.cwd();
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;

  protected async processInboundMessage(
    senderId: string,
    chatId: string,
    messageType: 'private' | 'group',
    rawEvent: any,
    messageId?: string
  ): Promise<void> {
    if (!this.isAllowed(senderId, messageType)) {
      this.log.debug('Inbound message rejected by allowlist', {
        channel: this.name,
        senderId,
        messageType
      });
      return;
    }

    const parsed = await this.parseMessage(rawEvent);

    let downloadedFiles: InboundFile[] | undefined;
    let resolvedContent = parsed.content;
    if (parsed.files && parsed.files.length > 0) {
      downloadedFiles = await this.downloadFiles(parsed.files);
      resolvedContent = this.resolveDownloadedFilePlaceholders(parsed.content, downloadedFiles);
    }

    await this.publishInbound(
      senderId,
      chatId,
      resolvedContent,
      rawEvent,
      messageId,
      messageType,
      parsed.media,
      downloadedFiles
    );
  }

  protected abstract parseMessage(rawEvent: any): Promise<ParsedMessage>;

  protected isAllowed(senderId: string, messageType?: 'private' | 'group'): boolean {
    if (messageType === 'group') {
      const groupAllowFrom = this.config.groupAllowFrom;
      if (!groupAllowFrom || groupAllowFrom.length === 0) return true;
      return groupAllowFrom.includes(senderId);
    } else {
      const friendAllowFrom = this.config.friendAllowFrom;
      if (!friendAllowFrom || friendAllowFrom.length === 0) return true;
      return friendAllowFrom.includes(senderId);
    }
  }

  protected validateMessage(msg: OutboundMessage): boolean {
    const hasContent = msg.content && msg.content.trim().length > 0;
    const hasMedia = msg.media && msg.media.length > 0;
    const hasFiles = msg.files && msg.files.length > 0;

    if (!hasContent && !hasMedia && !hasFiles) {
      this.log.error('Outbound message rejected: empty payload', {
        channel: this.name,
        chatId: msg.chatId,
        messageType: msg.messageType || 'private'
      });
      return false;
    }

    return true;
  }

  protected async downloadFiles(
    files: InboundFile[],
    headers?: Record<string, string>
  ): Promise<InboundFile[]> {
    const downloadDir = join(this.workspace, 'downloads');
    await mkdir(downloadDir, { recursive: true });

    const downloaded: InboundFile[] = [];

    for (const file of files) {
      if (!file.url) {
        downloaded.push(file);
        continue;
      }

      try {
        const response = await fetch(file.url, { headers });

        if (!response.ok) {
          this.log.warn('File download failed', {
            channel: this.name,
            fileName: file.name,
            status: response.status
          });
          downloaded.push(file);
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const localPath = join(downloadDir, basename(file.name));
        await writeFile(localPath, buffer);

        downloaded.push({ ...file, localPath });
        this.log.debug('File downloaded', {
          channel: this.name,
          fileName: file.name,
          localPath
        });
      } catch (error) {
        this.log.warn('File download failed', {
          channel: this.name,
          fileName: file.name,
          error
        });
        downloaded.push(file);
      }
    }

    return downloaded;
  }

  protected resolveDownloadedFilePlaceholders(content: string, files: InboundFile[]): string {
    let resolvedContent = content;

    for (const file of files) {
      if (!file.localPath) {
        continue;
      }

      resolvedContent = resolvedContent.replace(
        `[文件: ${file.name}]`,
        `[文件: ${file.localPath}]`
      );
    }

    return resolvedContent;
  }

  protected async publishInbound(
    senderId: string,
    chatId: string,
    content: string,
    rawEvent?: any,
    messageId?: string,
    messageType?: 'private' | 'group',
    media?: string[],
    files?: InboundFile[]
  ): Promise<void> {
    const msg: InboundMessage = {
      channel: this.name,
      senderId,
      chatId,
      content,
      rawEvent,
      timestamp: new Date(),
      messageId,
      messageType,
      media,
      files
    };

    await this.eventBus.publishInbound(msg);
  }

  isRunning(): boolean {
    return this.running;
  }
}
