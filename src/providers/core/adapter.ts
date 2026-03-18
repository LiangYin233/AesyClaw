import type { LLMMessage, LLMResponse, ToolDefinition } from '../../types.js';

export interface ProviderCapabilityProfile {
  supportsTools: boolean;
  supportsVisionInput: boolean;
  supportsReasoning: boolean;
  supportsStatefulConversation: boolean;
}

export interface ProviderRuntimeConfig {
  apiKey?: string;
  apiBase?: string;
  headers?: Record<string, string>;
  extraBody?: Record<string, any>;
}

export interface ProviderChatOptions {
  maxTokens?: number;
  temperature?: number;
  reasoning?: boolean;
  signal?: AbortSignal;
}

export interface ProviderLogContext {
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface ProviderRequest {
  path: string;
  method?: 'POST';
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ProviderResponseMeta {
  status: number;
  statusText: string;
  url: string;
  headers: Headers;
  contentType: string;
  rawText: string;
}

export interface ProviderAdapter {
  readonly type: string;
  readonly displayName: string;
  readonly defaultApiBase: string;
  capabilities(): ProviderCapabilityProfile;
  buildRequest(
    messages: LLMMessage[],
    tools: ToolDefinition[] | undefined,
    model: string,
    options: ProviderChatOptions | undefined,
    config: ProviderRuntimeConfig,
    context: ProviderLogContext
  ): ProviderRequest;
  parseResponse(data: unknown, context: ProviderLogContext): LLMResponse;
  extractErrorMessage(data: unknown): string | undefined;
  diagnoseEmptyBody?(meta: ProviderResponseMeta): string | undefined;
  diagnoseInvalidJson?(meta: ProviderResponseMeta): string | undefined;
}
