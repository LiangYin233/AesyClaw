import {
  ILLMProvider,
  LLMProviderConfig,
  LLMProviderType,
  LLMMode,
  StandardMessage,
  StandardResponse,
  ToolCall,
  TokenUsage,
  MessageRole,
} from './types.js';
import { ToolDefinition } from '../../platform/tools/types.js';
import { OpenAIChatAdapter } from './adapters/openai-chat-adapter.js';
import { OpenAICompletionAdapter } from './adapters/openai-completion-adapter.js';
import { AnthropicAdapter } from './adapters/anthropic-adapter.js';
import { logger } from '../../platform/observability/logger.js';

export interface ModelCapabilities {
  reasoning: boolean;
  vision: boolean;
}

export interface LLMConfig {
  provider: LLMProviderType;
  mode?: LLMMode;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  capabilities?: ModelCapabilities;
}

export class LLMProviderFactory {
  private static instance: LLMProviderFactory;
  private adapters: Map<string, ILLMProvider> = new Map();

  private constructor() {
    logger.info('LLMProviderFactory singleton initialized');
  }

  static getInstance(): LLMProviderFactory {
    if (!LLMProviderFactory.instance) {
      LLMProviderFactory.instance = new LLMProviderFactory();
    }
    return LLMProviderFactory.instance;
  }

  createAdapter(config: LLMConfig): ILLMProvider {
    const cacheKey = this.getCacheKey(config);

    if (this.adapters.has(cacheKey)) {
      logger.debug({ cacheKey, provider: config.provider }, '复用已存在的 LLM Adapter');
      return this.adapters.get(cacheKey)!;
    }

    let adapter: ILLMProvider;

    switch (config.provider) {
      case LLMProviderType.OpenAIChat:
        adapter = new OpenAIChatAdapter({
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          timeout: config.timeout,
        });
        break;

      case LLMProviderType.OpenAICompletion:
        adapter = new OpenAICompletionAdapter({
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          timeout: config.timeout,
        });
        break;

      case LLMProviderType.Anthropic:
        adapter = new AnthropicAdapter({
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          timeout: config.timeout,
        });
        break;

      default:
        throw new Error(`不支持的 LLM Provider 类型: ${config.provider}`);
    }

    this.adapters.set(cacheKey, adapter);
    logger.info(
      { cacheKey, provider: config.provider, model: config.model },
      '🆕 创建新的 LLM Adapter 实例'
    );

    return adapter;
  }

  private getCacheKey(config: LLMConfig): string {
    return `${config.provider}:${config.model || 'default'}:${config.mode || 'chat'}`;
  }

  hasAdapter(cacheKey: string): boolean {
    return this.adapters.has(cacheKey);
  }

  clearCache(): void {
    this.adapters.clear();
    logger.info('LLM Adapter cache cleared');
  }
}

export class LLMSession {
  private adapter: ILLMProvider;
  private tools: ToolDefinition[];
  private messages: StandardMessage[] = [];
  private totalTokenUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  constructor(adapter: ILLMProvider, tools: ToolDefinition[] = []) {
    this.adapter = adapter;
    this.tools = tools;
    logger.debug(
      { provider: adapter.providerType, toolCount: tools.length },
      '💬 创建新的 LLM Session'
    );
  }

  async generate(messages: StandardMessage[]): Promise<StandardResponse> {
    try {
      const response = await this.adapter.generate(messages, this.tools);

      if (response.text) {
        this.addMessage({
          role: MessageRole.Assistant,
          content: response.text,
          toolCalls: response.toolCalls,
        });
      }

      if (response.tokenUsage) {
        this.totalTokenUsage.promptTokens += response.tokenUsage.promptTokens;
        this.totalTokenUsage.completionTokens += response.tokenUsage.completionTokens;
        this.totalTokenUsage.totalTokens += response.tokenUsage.totalTokens;
      }

      return response;
    } catch (error) {
      throw error;
    }
  }

  addToolResult(toolCallId: string, toolName: string, result: string): void {
    this.addMessage({
      role: MessageRole.Tool,
      content: result,
      toolCallId,
      name: toolName,
    });
  }

  addMessage(message: StandardMessage): void {
    this.messages.push(message);
  }

  getMessages(): StandardMessage[] {
    return [...this.messages];
  }

  getTotalTokenUsage(): TokenUsage {
    return { ...this.totalTokenUsage };
  }

  getToolCalls(): ToolCall[] {
    return this.messages
      .filter(m => m.role === 'assistant' && m.toolCalls)
      .flatMap(m => m.toolCalls || []);
  }

  clearHistory(): void {
    this.messages = [];
    logger.debug('LLM Session history cleared');
  }
}

export function createLLMSession(config: LLMConfig, tools: ToolDefinition[] = []): LLMSession {
  const factory = LLMProviderFactory.getInstance();
  const adapter = factory.createAdapter(config);
  return new LLMSession(adapter, tools);
}
