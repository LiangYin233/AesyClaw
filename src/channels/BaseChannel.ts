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

  // ============ Abstract methods - must be implemented by subclasses ============

  /**
   * Start the channel (connect to platform)
   */
  abstract start(): Promise<void>;

  /**
   * Stop the channel (disconnect from platform)
   */
  abstract stop(): Promise<void>;

  /**
   * Send a message to the platform
   */
  abstract send(msg: OutboundMessage): Promise<void>;

  // ============ Template methods - standardized message processing pipeline ============

  /**
   * Process incoming message (template method)
   *
   * Standard pipeline:
   * 1. Permission check
   * 2. Parse message content
   * 3. Download files if present
   * 4. Publish to EventBus
   *
   * Subclasses should call this method after receiving platform events
   */
  protected async processInboundMessage(
    senderId: string,
    chatId: string,
    messageType: 'private' | 'group',
    rawEvent: any,
    messageId?: string
  ): Promise<void> {
    // Step 1: Permission check
    if (!this.isAllowed(senderId, messageType)) {
      this.log.debug(`Message from ${senderId} not allowed`);
      return;
    }

    // Step 2: Parse message (platform-specific)
    const parsed = await this.parseMessage(rawEvent);

    // Step 3: Download files if present
    let downloadedFiles: InboundFile[] | undefined;
    if (parsed.files && parsed.files.length > 0) {
      downloadedFiles = await this.downloadFiles(parsed.files);
    }

    // Step 4: Publish to EventBus
    await this.publishInbound(
      senderId,
      chatId,
      parsed.content,
      rawEvent,
      messageId,
      messageType,
      parsed.media,
      downloadedFiles
    );
  }

  /**
   * Parse platform-specific message format to standardized format
   *
   * Subclasses must implement this to convert platform events to ParsedMessage
   */
  protected abstract parseMessage(rawEvent: any): Promise<ParsedMessage>;

  // ============ Utility methods - shared across all channels ============

  /**
   * Check if sender is allowed to send messages
   */
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

  /**
   * Validate outbound message
   */
  protected validateMessage(msg: OutboundMessage): boolean {
    const hasContent = msg.content && msg.content.trim().length > 0;
    const hasMedia = msg.media && msg.media.length > 0;

    if (!hasContent && !hasMedia) {
      this.log.error(`[${this.name}] Attempted to send empty message to ${msg.messageType || 'private'}:${msg.chatId}`);
      return false;
    }

    return true;
  }

  /**
   * Download files to local workspace
   *
   * @param files - Files to download
   * @param headers - Optional headers for authentication
   * @returns Downloaded files with localPath set
   */
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
          this.log.warn(`Failed to download ${file.name}: HTTP ${response.status}`);
          downloaded.push(file);
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const localPath = join(downloadDir, basename(file.name));
        await writeFile(localPath, buffer);

        downloaded.push({ ...file, localPath });
        this.log.info(`File downloaded: ${file.name} -> ${localPath}`);
      } catch (err) {
        this.log.warn(`Failed to download ${file.name}:`, err);
        downloaded.push(file);
      }
    }

    return downloaded;
  }

  /**
   * Publish inbound message to EventBus
   */
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
