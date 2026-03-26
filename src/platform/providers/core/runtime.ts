import { isRetryableProviderError } from './errors.js';
import { logger, preview } from '../../observability/index.js';
import type { LLMMessage, LLMResponse, ToolDefinition } from '../../../types.js';
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

function shouldRetryProviderError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return false;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return false;
  }

  return isRetryableProviderError(error);
}

export class ProviderRuntime {
  private log = logger.child('Provider');

  constructor(
    private adapter: ProviderAdapter,
    private config: ProviderRuntimeConfig
  ) {}

  async chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    model?: string,
    options?: ProviderChatOptions
  ): Promise<LLMResponse> {
    const explicitModel = typeof model === 'string' && model.length > 0;
    if (!explicitModel) {
      throw new Error(`${this.adapter.displayName} requires an explicit model`);
    }

    const modelName = model;
    const providerLog = this.log.withFields({
      'provider/model': `${this.adapter.type}/${modelName}`
    });
    const apiBase = this.config.apiBase || this.adapter.defaultApiBase;
    const context: ProviderLogContext = {
      warn: (message, fields) => {
        providerLog.warn(message, fields);
      }
    };

    let lastError: unknown;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        providerLog.debug('模型请求开始', {
          'attempt/Max': `${attempt}/${maxAttempts}`,
          method: request.method || 'POST',
          path: request.path,
          messageCount: messages.length,
          toolCount: tools?.length || 0
        });

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
          throw new Error(this.adapter.extractErrorMessage(data) || `API Error: ${response.status} ${response.statusText}`);
        }

        const errorMessage = this.adapter.extractErrorMessage(data);
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        providerLog.debug('模型请求完成', {
          'attempt/Max': `${attempt}/${maxAttempts}`,
          status: response.status
        });
        return this.adapter.parseResponse(data, context);
      } catch (error: unknown) {
        lastError = error;
        const retryable = shouldRetryProviderError(error, options?.signal);

        if (attempt >= maxAttempts || !retryable) {
          providerLog.error('模型请求失败', {
            'attempt/Max': `${attempt}/${maxAttempts}`,
            error
          });
          throw error;
        }

        providerLog.warn('模型请求准备重试', {
          'attempt/Max': `${attempt}/${maxAttempts}`,
          error
        });
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Provider request failed');
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
