import { basename, join } from 'path';
import { randomUUID } from 'crypto';
import type { Database } from '../../db/index.js';
import { logger } from '../../observability/index.js';
import type { InboundMessage, OutboundMessage } from '../../types.js';
import type { ChannelAdapter } from './adapter.js';
import { DeliveryQueue } from './delivery-queue.js';
import { projectMessage } from './projection.js';
import { ResourceStore } from './resource-store.js';
import type { AdapterInboundDraft, ChannelMessage, DeliveryReceipt, MessageSegment, QuoteSegment, ResourceHandle } from './types.js';

function isChannelMessage(value: OutboundMessage | ChannelMessage): value is ChannelMessage {
  return !!value && typeof value === 'object' && 'conversation' in value && 'segments' in value && 'timestamp' in value;
}

function normalizeTimestamp(timestamp?: Date): Date {
  return timestamp instanceof Date ? timestamp : new Date();
}

function restoreLiteralNewlines(text: string): string {
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');
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
  const resourceId = randomUUID().slice(0, 8);
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

export class ChannelRuntime {
  private log = logger.child('ChannelRuntime');
  private adapters = new Map<string, ChannelAdapter>();
  private resourceStore: ResourceStore;
  private deliveryQueue: DeliveryQueue;
  private queueStarted = false;
  private inboundHandler?: (message: InboundMessage) => Promise<void>;

  constructor(
    db: Database,
    private workspace: string
  ) {
    const assetsRoot = join(process.cwd(), '.aesyclaw', 'channel-assets');
    this.resourceStore = new ResourceStore(db, assetsRoot);
    this.deliveryQueue = new DeliveryQueue(db);
  }

  get assetsRoot(): string {
    return this.resourceStore.assetsRoot;
  }

  registerAdapter(name: string, adapter: ChannelAdapter): void {
    this.adapters.set(name, adapter);
  }

  setInboundHandler(handler: (message: InboundMessage) => Promise<void>): void {
    this.inboundHandler = handler;
  }

  unregisterAdapter(name: string): void {
    this.adapters.delete(name);
  }

  getAdapter(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }

  async start(): Promise<void> {
    if (this.queueStarted) {
      return;
    }

    await this.deliveryQueue.start(
      async (job) => {
        const adapter = this.adapters.get(job.channel);
        if (!adapter) {
          throw new Error(`Channel adapter missing: ${job.channel}`);
        }
        return adapter.send(job.payload, {
          jobId: job.jobId,
          idempotencyKey: job.idempotencyKey
        });
      },
      (job, error) => {
        const adapter = this.adapters.get(job.channel);
        return adapter?.classifyError(error) || {
          retryable: false,
          code: 'adapter_missing',
          message: error instanceof Error ? error.message : String(error)
        };
      }
    );
    this.queueStarted = true;
  }

  stop(): void {
    this.deliveryQueue.stop();
    this.queueStarted = false;
  }

  async startAdapter(name: string): Promise<void> {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(`Channel adapter missing: ${name}`);
    }

    await adapter.start({
      workspace: this.workspace,
      assetsRoot: this.assetsRoot,
      ingest: (rawEvent) => this.ingestRaw(name, rawEvent)
    });
  }

  async stopAdapter(name: string): Promise<void> {
    await this.adapters.get(name)?.stop();
  }

  async ingestRaw(channel: string, rawEvent: any): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      return;
    }

    const draft = await adapter.decodeInbound(rawEvent);
    if (!draft) {
      return;
    }

    let message = this.materializeDraft(channel, draft, 'inbound');
    message = await this.expandQuotes(adapter, message, rawEvent);
    message = await this.resourceStore.ensureLocalResources(message);

    const projected = projectMessage(message);
    message = { ...message, projection: projected.projection };

    const inbound: InboundMessage = {
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
      projection: message.projection,
      conversation: message.conversation,
      sender: message.sender,
      direction: message.direction,
      platformMessageId: message.platformMessageId,
      id: message.id
    };

    if (!this.inboundHandler) {
      this.log.warn('未设置入站消息处理器', {
        channel: inbound.channel,
        chatId: inbound.chatId
      });
      return;
    }

    await this.inboundHandler(inbound);
  }

  async dispatch(message: OutboundMessage | ChannelMessage): Promise<DeliveryReceipt> {
    if (!this.queueStarted) {
      await this.start();
    }

    let outbound = this.normalizeOutbound(message);
    outbound = await this.resourceStore.ensureLocalResources(outbound);
    outbound = { ...outbound, projection: projectMessage(outbound).projection };

    if (outbound.segments.length === 0) {
      throw new Error('Outbound message rejected: empty payload');
    }

    const idempotencyKey = (
      isChannelMessage(message)
        ? message.metadata?.idempotencyKey
        : message.idempotencyKey || message.metadata?.idempotencyKey
    ) || randomUUID();
    return this.deliveryQueue.dispatch({
      channel: outbound.channel,
      conversationId: outbound.conversation.id,
      payload: outbound,
      idempotencyKey
    });
  }

  private materializeDraft(channel: string, draft: AdapterInboundDraft, direction: ChannelMessage['direction']): ChannelMessage {
    return {
      id: draft.platformMessageId || randomUUID(),
      channel,
      direction,
      conversation: draft.conversation,
      sender: draft.sender,
      timestamp: normalizeTimestamp(draft.timestamp),
      platformMessageId: draft.platformMessageId,
      segments: draft.segments,
      metadata: draft.metadata,
      rawEvent: draft.rawEvent
    };
  }

  private async expandQuotes(adapter: ChannelAdapter, message: ChannelMessage, rawEvent?: any): Promise<ChannelMessage> {
    if (!adapter.fetchQuotedMessage) {
      return message;
    }

    const segments: MessageSegment[] = [];
    for (const segment of message.segments) {
      if (segment.type !== 'quote' || segment.message) {
        segments.push(segment);
        continue;
      }

      try {
        const quotedDraft = await adapter.fetchQuotedMessage(segment.reference, rawEvent);
        segments.push({
          ...segment,
          message: quotedDraft ? this.materializeDraft(message.channel, quotedDraft, 'inbound') : undefined
        } satisfies QuoteSegment);
      } catch (error) {
        this.log.warn('引用消息展开失败', {
          channel: message.channel,
          messageId: message.id,
          platformMessageId: segment.reference.platformMessageId,
          error: error instanceof Error ? error.message : String(error)
        });
        segments.push(segment);
      }
    }

    return {
      ...message,
      segments
    };
  }

  private normalizeOutbound(message: OutboundMessage | ChannelMessage): ChannelMessage {
    if (isChannelMessage(message)) {
      return {
        ...message,
        direction: 'outbound',
        timestamp: normalizeTimestamp(message.timestamp)
      };
    }

    if (Array.isArray(message.segments) && message.segments.length > 0) {
      const segments = normalizeOutboundSegments([...message.segments]);
      if (message.replyTo && !segments.some((segment) => segment.type === 'quote')) {
        segments.unshift({
          type: 'quote',
          reference: { platformMessageId: message.replyTo }
        });
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

    const segments: MessageSegment[] = [];

    if (message.replyTo) {
      segments.push({
        type: 'quote',
        reference: { platformMessageId: message.replyTo }
      });
    }

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
}
