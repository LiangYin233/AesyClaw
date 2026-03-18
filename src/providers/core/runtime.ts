import { normalizeError, isRetryableError } from '../../errors/index.js';
import { logger, preview } from '../../observability/index.js';
import type { LLMMessage, LLMResponse, ToolDefinition } from '../../types.js';
import type {
  ProviderAdapter,
  ProviderChatOptions,
  ProviderLogContext,
  ProviderResponseMeta,
  ProviderRuntimeConfig
} from './adapter.js';

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ProviderRuntime {
  private log = logger.child('Provider');

  constructor(
    private adapter: ProviderAdapter,
    private config: ProviderRuntimeConfig
  ) {}

  getDefaultModel(): string {
    return this.adapter.defaultModel;
  }

  async chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    model?: string,
    options?: ProviderChatOptions
  ): Promise<LLMResponse> {
    const explicitModel = typeof model === 'string' && model.length > 0;
    const modelName = explicitModel ? model : this.getDefaultModel();
    const apiBase = this.config.apiBase || this.adapter.defaultApiBase;
    const startedAt = Date.now();
    const context: ProviderLogContext = {
      warn: (message, fields) => this.log.warn(message, fields)
    };

    if (!explicitModel) {
      this.adapter.onMissingModel?.(context, modelName);
    }

    this.log.debug('Provider request started', {
      providerType: this.adapter.type,
      providerName: this.adapter.displayName,
      model: modelName,
      apiBase,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
      reasoning: options?.reasoning === true
    });

    try {
      const request = this.adapter.buildRequest(messages, tools, modelName, options, this.config, context);
      const url = joinUrl(apiBase, request.path);
      const headers = {
        ...(request.headers || {}),
        ...(this.config.headers || {})
      };
      const body = {
        ...request.body,
        ...(this.config.extraBody || {})
      };

      const response = await fetch(url, {
        method: request.method || 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options?.signal
      });

      const rawText = await response.text();
      const meta: ProviderResponseMeta = {
        status: response.status,
        statusText: response.statusText,
        url,
        headers: response.headers,
        contentType: response.headers.get('content-type') || '(missing)',
        rawText
      };

      const data = this.parseResponseBody(meta);

      if (!response.ok) {
        this.log.error(`API 请求错误: ${response.status} ${response.statusText}`, {
          status: response.status,
          statusText: response.statusText,
          response: data,
          bodyPreview: data === undefined ? preview(rawText) : undefined
        });
        throw new Error(this.adapter.extractErrorMessage(data) || `API Error: ${response.status} ${response.statusText}`);
      }

      const errorMessage = this.adapter.extractErrorMessage(data);
      if (errorMessage) {
        this.log.error('响应错误', {
          providerType: this.adapter.type,
          response: data
        });
        throw new Error(errorMessage);
      }

      const parsed = this.adapter.parseResponse(data, context);
      const durationMs = Date.now() - startedAt;

      this.log.info('提供商请求完成', {
        providerType: this.adapter.type,
        model: modelName,
        durationMs,
        finishReason: parsed.finishReason,
        toolCallCount: parsed.toolCalls.length,
        promptTokens: parsed.usage?.prompt_tokens,
        completionTokens: parsed.usage?.completion_tokens,
        totalTokens: parsed.usage?.total_tokens
      });

      return parsed;
    } catch (error: unknown) {
      const message = normalizeError(error);
      this.log.error('提供商请求失败', {
        providerType: this.adapter.type,
        model: modelName,
        durationMs: Date.now() - startedAt,
        retryable: isRetryableError(error),
        error: message
      });
      throw error;
    }
  }

  private parseResponseBody(meta: ProviderResponseMeta): unknown {
    if (!meta.rawText.trim()) {
      const diagnosis = this.adapter.diagnoseEmptyBody?.(meta);
      if (diagnosis) {
        throw new Error(diagnosis);
      }

      throw new Error(
        `${this.adapter.displayName} API returned an empty response body (${meta.status} ${meta.statusText})`
      );
    }

    try {
      return JSON.parse(meta.rawText);
    } catch {
      const diagnosis = this.adapter.diagnoseInvalidJson?.(meta);
      if (diagnosis) {
        throw new Error(diagnosis);
      }

      throw new Error(
        `${this.adapter.displayName} API returned invalid JSON: status=${meta.status}, content-type=${meta.contentType}, body=${preview(meta.rawText)}`
      );
    }
  }
}
