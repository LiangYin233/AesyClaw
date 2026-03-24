import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Database } from '../../db/index.js';
import { logger } from '../../observability/index.js';
import type { InboundMessage, OutboundMessage } from '../../types.js';
import type { ChannelAdapter } from './adapter.js';
import { DeliveryQueue } from './delivery-queue.js';
import { projectChannelMessage } from './projection.js';
import { ResourceStore } from './resource-store.js';
import type { AdapterInboundDraft, ChannelMessage, DeliveryReceipt, MessageSegment, QuoteSegment } from './types.js';
import { mapChannelMessageToCompatInbound, mapCompatOutboundToChannelMessage } from './messageCompat.js';
import { mapDraftToChannelMessage } from './messageMappers.js';
import { processInboundMessage } from './inboundPipeline.js';
import { prepareOutboundMessage } from './outboundPipeline.js';

function isChannelMessage(value: OutboundMessage | ChannelMessage): value is ChannelMessage {
  return !!value && typeof value === 'object' && 'conversation' in value && 'segments' in value && 'timestamp' in value;
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

    const inbound = await processInboundMessage({
      adapter,
      channelName: channel,
      rawEvent,
      draft,
      materializeDraft: (channelName, nextDraft, direction) => this.materializeDraft(channelName, nextDraft, direction),
      expandQuotes: (nextAdapter, message, nextRawEvent) => this.expandQuotes(nextAdapter, message, nextRawEvent),
      localizeResources: (message) => this.resourceStore.ensureLocalResources(
        message,
        adapter.resolveResource?.bind(adapter)
      ),
      projectChannelMessage,
      mapChannelMessageToCompatInbound
    });

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

    const outbound = await prepareOutboundMessage({
      message,
      isChannelMessage,
      normalizeChannelMessage: (nextMessage) => this.normalizeOutbound(nextMessage),
      normalizeExistingChannelMessage: (nextMessage) => this.normalizeOutbound(nextMessage),
      localizeResources: (nextMessage) => this.resourceStore.ensureLocalResources(nextMessage),
      projectChannelMessage
    });

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
    return mapDraftToChannelMessage(channel, draft, direction);
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
        timestamp: message.timestamp instanceof Date ? message.timestamp : new Date()
      };
    }

    return mapCompatOutboundToChannelMessage(message);
  }
}
