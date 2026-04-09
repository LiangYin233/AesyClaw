import {
  ILLMProvider,
  LLMProviderType,
  LLMMode,
  StandardMessage,
  StandardResponse,
  ToolCall,
  TokenUsage,
  MessageRole,
  UnifiedLLMClientConfig,
} from './types.js';
import { ToolDefinition } from '../../platform/tools/types.js';
import { OpenAIChatAdapter } from './adapters/openai-chat-adapter.js';
import { OpenAICompletionAdapter } from './adapters/openai-completion-adapter.js';
import { AnthropicAdapter } from './adapters/anthropic-adapter.js';
import { logger } from '../../platform/observability/logger.js';
import { PromptContext } from './prompt-context.js';
import { UnifiedLLMClient } from './unified-client.js';

export interface ModelCapabilities {
  reasoning: boolean;
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

  constructor() {
    logger.info('LLMProviderFactory initialized');
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
}

/**
 * LLM 会话类
 * 保持向后兼容的接口设计
 */
export class LLMSession {
  /** 统一 LLM 客户端实例 */
  private client: UnifiedLLMClient;
  
  /** 工具定义列表 */
  private tools: ToolDefinition[];
  
  /** 消息历史 */
  private messages: StandardMessage[] = [];
  
  /** 总 Token 使用量统计 */
  private totalTokenUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  /**
   * 创建 LLM 会话实例
   * @param client UnifiedLLMClient 实例
   * @param tools 工具定义列表
   */
  constructor(client: UnifiedLLMClient, tools: ToolDefinition[] = []) {
    this.client = client;
    this.tools = tools;
    logger.debug(
      { toolCount: tools.length },
      '💬 创建新的 LLM Session (使用 UnifiedLLMClient)'
    );
  }

  /**
   * 生成响应
   * 向后兼容接口：接收 PromptContext 并转换为 UnifiedLLMClient 所需格式
   * @param context Prompt 上下文
   * @returns 标准响应
   */
  async generate(context: PromptContext): Promise<StandardResponse> {
    // 从 PromptContext 提取消息，合并现有消息历史
    const contextMessages = context.messages || [];
    
    // 使用 UnifiedLLMClient 生成响应
    const response = await this.client.generate({
      messages: contextMessages,
      systemPrompt: context.system?.systemPrompt,
      tools: this.tools,
    });

    // 如果响应包含文本，添加到消息历史
    if (response.text) {
      this.addMessage({
        role: MessageRole.Assistant,
        content: response.text,
        toolCalls: response.toolCalls,
      });
    }

    // 累加 Token 使用量
    if (response.tokenUsage) {
      this.totalTokenUsage.promptTokens += response.tokenUsage.promptTokens;
      this.totalTokenUsage.completionTokens += response.tokenUsage.completionTokens;
      this.totalTokenUsage.totalTokens += response.tokenUsage.totalTokens;
    }

    return response;
  }

  /**
   * 添加工具调用结果到消息历史
   * @param toolCallId 工具调用 ID
   * @param toolName 工具名称
   * @param result 工具执行结果
   */
  addToolResult(toolCallId: string, toolName: string, result: string): void {
    this.addMessage({
      role: MessageRole.Tool,
      content: result,
      toolCallId,
      name: toolName,
    });
  }

  /**
   * 添加消息到历史
   * @param message 标准消息
   */
  addMessage(message: StandardMessage): void {
    this.messages.push(message);
  }
}

/**
 * 创建 LLM 会话实例
 * 工厂函数：根据配置创建 UnifiedLLMClient 并初始化 LLMSession
 * @param config LLM 配置
 * @param tools 工具定义列表
 * @returns LLMSession 实例
 */
export function createLLMSession(config: LLMConfig, tools: ToolDefinition[] = []): LLMSession {
  // 构建 UnifiedLLMClient 配置
  const clientConfig: UnifiedLLMClientConfig = {
    provider: config.provider,
    model: config.model || 'gpt-4o-mini',
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeout: config.timeout,
    cacheEnabled: false, // LLMSession 默认不启用缓存，避免工具调用结果缓存
    streamEnabled: false,
  };

  // 创建 UnifiedLLMClient 实例
  const client = new UnifiedLLMClient(clientConfig);

  logger.info(
    { provider: config.provider, model: config.model, toolCount: tools.length },
    '🆕 创建新的 LLMSession (使用 UnifiedLLMClient)'
  );

  return new LLMSession(client, tools);
}

export const llmProviderFactory = new LLMProviderFactory();
