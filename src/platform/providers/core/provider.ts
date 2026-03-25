import type { LLMMessage, LLMResponse, ToolDefinition } from '../../../types.js';
import { LLMProvider } from '../base.js';
import type { ProviderAdapter, ProviderChatOptions } from './adapter.js';
import { ProviderRuntime } from './runtime.js';

export class RuntimeBackedProvider extends LLMProvider {
  private runtime: ProviderRuntime;

  constructor(
    adapter: ProviderAdapter,
    apiKey?: string,
    apiBase?: string,
    headers?: Record<string, string>,
    extraBody?: Record<string, any>
  ) {
    super(apiKey, apiBase, headers, extraBody);
    this.runtime = new ProviderRuntime(adapter, {
      apiKey,
      apiBase,
      headers,
      extraBody
    });
  }

  async chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    model?: string,
    options?: ProviderChatOptions
  ): Promise<LLMResponse> {
    return this.runtime.chat(messages, tools, model, options);
  }
}
