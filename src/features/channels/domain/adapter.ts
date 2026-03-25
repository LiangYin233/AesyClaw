import type {
  AdapterInboundDraft,
  AdapterSendResult,
  ChannelCapabilityProfile,
  ChannelMessage,
  QuoteReference
} from './types.js';

export interface AdapterRuntimeContext {
  workspace: string;
  assetsRoot: string;
  ingest: (rawEvent: any) => Promise<void>;
}

export interface ChannelSendContext {
  jobId: string;
  idempotencyKey: string;
}

export interface ChannelAdapter {
  readonly name: string;
  start(ctx: AdapterRuntimeContext): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  capabilities(): ChannelCapabilityProfile;
  decodeInbound(rawEvent: any): Promise<AdapterInboundDraft | null> | AdapterInboundDraft | null;
  resolveResource?(
    resource: import('./types.js').ResourceHandle,
    rawEvent?: unknown
  ): Promise<import('./types.js').ResourceHandle | null>;
  fetchQuotedMessage?(reference: QuoteReference, rawEvent?: any): Promise<AdapterInboundDraft | null>;
  send(message: ChannelMessage, context: ChannelSendContext): Promise<AdapterSendResult>;
  classifyError(error: unknown): { retryable: boolean; code: string; message?: string };
}
