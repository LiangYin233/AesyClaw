/**
 * 统一 LLM 客户端模块
 * 提供一致的 LLM 调用接口，集成缓存、错误处理、指标收集等功能
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import {
  LLMProviderType,
  StandardMessage,
  StandardResponse,
  TokenUsage,
  ToolCall,
  UnifiedLLMClientConfig,
  UnifiedRequestOptions,
  BatchRequestItem,
  BatchRequestResult,
  StreamCallbacks,
  UnifiedClientEvent,
  RequestOptions,
  RequestStartEventData,
  RequestCompleteEventData,
  RequestErrorEventData,
  CacheEventData,
  RetryEventData,
} from './types.js';
import { PromptContext } from './prompt-context.js';
import { ToolDefinition } from '../../platform/tools/types.js';
import { MessageTransformer } from './transformers/message-transformer.js';
import { ToolTransformer } from './transformers/tool-transformer.js';
import { ErrorHandler, RetryPolicy, DEFAULT_RETRY_POLICY, ErrorType, RetryCallback } from './error/error-handler.js';
import { CacheManager, CacheConfig, CacheStats } from './cache/cache-manager.js';
import { MetricsCollector, MetricsCollectorConfig, MetricsReport, RequestMetric } from './metrics/metrics-collector.js';
import { StreamHandler, StreamOutput } from './stream/stream-handler.js';
import { ILLMProvider } from './types.js';
import { LLMProviderFactory } from './factory.js';
import { logger } from '../../platform/observability/logger.js';

/**
 * 统一 LLM 客户端类
 * 提供统一的 LLM 调用接口，集成缓存、错误处理、指标收集等功能
 *
 * @example
 * ```typescript
 * const client = new UnifiedLLMClient({
 *   provider: LLMProviderType.OpenAIChat,
 *   model: 'gpt-4o-mini',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   cacheEnabled: true,
 * });
 *
 * // 标准调用
 * const response = await client.generate({
 *   messages: [{ role: MessageRole.User, content: 'Hello!' }],
 *   systemPrompt: 'You are a helpful assistant.',
 * });
 *
 * // 流式调用
 * await client.generateStream({
 *   messages: [{ role: MessageRole.User, content: 'Tell me a story' }],
 * }, {
 *   onToken: (text) => console.log(text),
 *   onComplete: (result) => console.log('Done:', result.text),
 * });
 *
 * // 批量调用
 * const results = await client.generateBatch([
 *   { id: '1', messages: [{ role: MessageRole.User, content: 'Hi' }] },
 *   { id: '2', messages: [{ role: MessageRole.User, content: 'Hello' }] },
 * ]);
 * ```
 */
export class UnifiedLLMClient extends EventEmitter {
  /** 提供商类型 */
  private readonly provider: LLMProviderType;

  /** 模型名称 */
  private readonly model: string;

  /** API 密钥 */
  private readonly apiKey?: string;

  /** API 基础地址 */
  private readonly baseUrl?: string;

  /** 请求超时时间 */
  private readonly timeout?: number;

  /** LLM 提供者实例 */
  private readonly adapter: ILLMProvider;

  /** 消息转换器 */
  private readonly messageTransformer: MessageTransformer;

  /** 工具转换器 */
  private readonly toolTransformer: ToolTransformer;

  /** 错误处理器 */
  private readonly errorHandler: ErrorHandler;

  /** 缓存管理器 */
  private readonly cacheManager?: CacheManager<StandardResponse>;

  /** 是否启用缓存 */
  private readonly cacheEnabled: boolean;

  /** 是否启用流式输出 */
  private readonly streamEnabled: boolean;

  /** 指标收集器 */
  private readonly metricsCollector: MetricsCollector;

  /** 默认请求选项 */
  private readonly defaultOptions: RequestOptions;

  /** 是否已销毁 */
  private destroyed: boolean = false;

  /**
   * 创建统一 LLM 客户端实例
   * @param config 客户端配置
   */
  constructor(config: UnifiedLLMClientConfig) {
    super();

    this.provider = config.provider;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout;
    this.cacheEnabled = config.cacheEnabled ?? false;
    this.streamEnabled = config.streamEnabled ?? false;

    // 初始化消息和工具转换器
    this.messageTransformer = new MessageTransformer();
    this.toolTransformer = new ToolTransformer();

    // 初始化错误处理器
    this.errorHandler = new ErrorHandler(config.retryPolicy);

    // 初始化缓存管理器
    if (this.cacheEnabled) {
      this.cacheManager = new CacheManager<StandardResponse>(config.cacheConfig);
    }

    // 初始化指标收集器
    this.metricsCollector = new MetricsCollector(config.metricsConfig);

    this.defaultOptions = config.defaultOptions ?? {};

    // 创建 LLM 提供者实例
    const factory = LLMProviderFactory.getInstance();
    this.adapter = factory.createAdapter({
      provider: this.provider,
      model: this.model,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      timeout: this.timeout,
    });

    logger.info(
      {
        provider: this.provider,
        model: this.model,
        cacheEnabled: this.cacheEnabled,
        streamEnabled: this.streamEnabled,
      },
      '🚀 UnifiedLLMClient 已初始化'
    );
  }

  /**
   * 标准 LLM 调用
   * 返回完整的响应结果
   *
   * @param params 请求参数
   * @param options 请求选项
   * @returns 标准响应
   */
  async generate(
    params: {
      messages: StandardMessage[];
      systemPrompt?: string;
      tools?: ToolDefinition[];
    },
    options?: UnifiedRequestOptions
  ): Promise<StandardResponse> {
    this.checkDestroyed();

    const requestId = this.generateRequestId();
    const startTime = Date.now();
    const useCache = options?.cacheEnabled ?? this.cacheEnabled;

    // 发射请求开始事件
    this.emitRequestStart(requestId, params.messages.length, useCache, false);

    // 生成缓存键
    const cacheKey = useCache ? this.generateCacheKey(params, options) : '';

    // 尝试从缓存获取
    if (useCache && this.cacheManager) {
      const cached = this.cacheManager.get(cacheKey);
      if (cached) {
        // 发射缓存命中事件
        this.emitCacheHit(cacheKey, requestId);

        // 记录指标
        this.metricsCollector.recordRequest({
          requestId,
          provider: this.provider,
          model: this.model,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date().toISOString(),
          latency: Date.now() - startTime,
          tokenUsage: cached.tokenUsage,
          success: true,
          estimatedCost: this.metricsCollector.calculateCost(this.model, cached.tokenUsage),
          metadata: { fromCache: true, ...options?.metadata },
        });

        // 发射请求完成事件
        this.emitRequestComplete(requestId, cached, Date.now() - startTime, true);

        return cached;
      } else {
        // 发射缓存未命中事件
        this.emitCacheMiss(cacheKey, requestId);
      }
    }

    // 开始指标记录
    const metricsRequestId = this.metricsCollector.startRequest(
      this.provider,
      this.model,
      options?.metadata
    );

    try {
      // 定义重试回调
      const onRetry: RetryCallback = (info) => {
        this.emitRetryAttempt(
          requestId,
          info.attempt,
          info.maxRetries,
          info.errorInfo.type,
          info.errorInfo.message,
          info.waitTime
        );
      };

      // 使用错误处理器执行请求（支持重试）
      const response = await this.errorHandler.executeWithRetry(
        async () => {
          // 构建 PromptContext
          const context = this.buildPromptContext(params, options);

          // 调用 LLM 提供者
          return await this.adapter.generate(context);
        },
        'LLM generate',
        onRetry
      );

      // 缓存响应
      if (useCache && this.cacheManager) {
        this.cacheManager.set(cacheKey, response, options?.cacheTTL);
      }

      const latency = Date.now() - startTime;

      // 记录成功指标
      this.metricsCollector.recordSuccess(
        metricsRequestId,
        response.tokenUsage,
        options?.metadata
      );

      // 发射请求完成事件
      this.emitRequestComplete(requestId, response, latency, false);

      return response;
    } catch (error: any) {
      // 记录失败指标
      const errorInfo = this.errorHandler.classifyError(error);
      this.metricsCollector.recordError(
        metricsRequestId,
        error.message,
        errorInfo.type,
        options?.metadata
      );

      // 发射请求错误事件
      this.emitRequestError(requestId, errorInfo.type, error.message, errorInfo.retryable ? 1 : 0);

      throw error;
    }
  }

  /**
   * 流式 LLM 调用
   * 实时返回 token
   *
   * @param params 请求参数
   * @param callbacks 流式回调
   * @param options 请求选项
   * @returns 流式处理器
   */
  async generateStream(
    params: {
      messages: StandardMessage[];
      systemPrompt?: string;
      tools?: ToolDefinition[];
    },
    callbacks: StreamCallbacks,
    options?: UnifiedRequestOptions
  ): Promise<StreamHandler> {
    this.checkDestroyed();

    const requestId = this.generateRequestId();
    const startTime = Date.now();

    // 发射请求开始事件
    this.emitRequestStart(requestId, params.messages.length, false, true);

    // 开始指标记录
    const metricsRequestId = this.metricsCollector.startRequest(
      this.provider,
      this.model,
      options?.metadata
    );

    try {
      // 构建 PromptContext
      const context = this.buildPromptContext(params, options);

      // 创建流式处理器
      const providerType = this.provider === LLMProviderType.Anthropic ? 'anthropic' : 'openai';
      const streamHandler = new StreamHandler({
        provider: providerType,
        debug: options?.metadata?.debug as boolean,
      });

      // 使用错误处理器执行流式请求
      await this.errorHandler.executeWithRetry(
        async () => {
          const stream = await this.adapter.generate(context);

          if (callbacks.onToken && stream.text) {
            callbacks.onToken(stream.text);
          }

          if (callbacks.onToolCall && stream.toolCalls) {
            stream.toolCalls.forEach(callbacks.onToolCall);
          }

          if (callbacks.onComplete) {
            callbacks.onComplete({
              text: stream.text,
              toolCalls: stream.toolCalls,
              tokenUsage: stream.tokenUsage,
              finishReason: stream.finishReason,
            });
          }

          this.metricsCollector.recordSuccess(
            metricsRequestId,
            stream.tokenUsage,
            options?.metadata
          );

          this.emitRequestComplete(requestId, stream, Date.now() - startTime, false);

          return stream;
        },
        'LLM generateStream'
      );

      return streamHandler;
    } catch (error: any) {
      // 记录失败指标
      const errorInfo = this.errorHandler.classifyError(error);
      this.metricsCollector.recordError(
        metricsRequestId,
        error.message,
        errorInfo.type,
        options?.metadata
      );

      // 发射请求错误事件
      this.emitRequestError(requestId, errorInfo.type, error.message, 0);

      if (callbacks.onError) {
        callbacks.onError(error);
      }

      throw error;
    }
  }

  /**
   * 批量 LLM 调用
   * 并发处理多个请求
   *
   * @param items 批量请求项
   * @param concurrency 并发数量（默认 5）
   * @returns 批量请求结果
   */
  async generateBatch(
    items: BatchRequestItem[],
    concurrency: number = 5
  ): Promise<BatchRequestResult[]> {
    this.checkDestroyed();

    logger.info(
      { itemCount: items.length, concurrency },
      '📦 开始批量 LLM 调用'
    );

    const results: BatchRequestResult[] = [];

    // 使用并发控制处理批量请求
    const chunks = this.chunkArray(items, concurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map(async (item) => {
          try {
            const response = await this.generate(
              {
                messages: item.messages,
                systemPrompt: item.systemPrompt,
                tools: item.tools,
              },
              item.options
            );

            return {
              id: item.id,
              response,
              success: true,
            };
          } catch (error: any) {
            return {
              id: item.id,
              error,
              success: false,
            };
          }
        })
      );

      // 处理结果
      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    logger.info(
      { total: items.length, success: successCount, failed: items.length - successCount },
      '✅ 批量 LLM 调用完成'
    );

    return results;
  }

  /**
   * 获取指标统计信息
   * @param startTime 开始时间（可选）
   * @param endTime 结束时间（可选）
   * @returns 指标报告
   */
  getMetrics(startTime?: Date, endTime?: Date): MetricsReport {
    return this.metricsCollector.getMetricsReport(startTime, endTime);
  }

  /**
   * 获取缓存统计信息
   * @returns 缓存统计信息
   */
  getCacheStats(): CacheStats | null {
    if (!this.cacheManager) {
      return null;
    }
    return this.cacheManager.getStats();
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    if (this.cacheManager) {
      this.cacheManager.clear();
      logger.info('🗑️ 缓存已清除');
    }
  }

  /**
   * 清除指标数据
   */
  clearMetrics(): void {
    this.metricsCollector.clear();
  }

  /**
   * 获取提供商类型
   * @returns 提供商类型
   */
  getProvider(): LLMProviderType {
    return this.provider;
  }

  /**
   * 获取模型名称
   * @returns 模型名称
   */
  getModel(): string {
    return this.model;
  }

  /**
   * 获取默认请求选项
   * @returns 默认请求选项
   */
  getDefaultOptions(): RequestOptions {
    return { ...this.defaultOptions };
  }

  /**
   * 更新重试策略
   * @param policy 重试策略
   */
  updateRetryPolicy(policy: Partial<RetryPolicy>): void {
    this.errorHandler.updatePolicy(policy);
  }

  /**
   * 销毁客户端
   * 释放资源
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    if (this.cacheManager) {
      this.cacheManager.destroy();
    }

    this.removeAllListeners();

    logger.info('👋 UnifiedLLMClient 已销毁');
  }

  /**
   * 检查是否已销毁
   */
  private checkDestroyed(): void {
    if (this.destroyed) {
      throw new Error('UnifiedLLMClient 已被销毁，无法继续使用');
    }
  }

  /**
   * 生成请求 ID
   * @returns 请求 ID
   */
  private generateRequestId(): string {
    return `${this.provider}-${this.model}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * 生成缓存键
   * @param params 请求参数
   * @param options 请求选项
   * @returns 缓存键
   */
  private generateCacheKey(
    params: {
      messages: StandardMessage[];
      systemPrompt?: string;
      tools?: ToolDefinition[];
    },
    options?: UnifiedRequestOptions
  ): string {
    const keyData = {
      provider: this.provider,
      model: this.model,
      messages: params.messages,
      systemPrompt: params.systemPrompt,
      tools: params.tools?.map((t) => t.name),
      options: {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        topP: options?.topP,
      },
    };

    const keyString = JSON.stringify(keyData);
    return createHash('sha256').update(keyString).digest('hex');
  }

  /**
   * 构建 PromptContext
   * @param params 请求参数
   * @param options 请求选项
   * @returns PromptContext
   */
  private buildPromptContext(
    params: {
      messages: StandardMessage[];
      systemPrompt?: string;
      tools?: ToolDefinition[];
    },
    options?: UnifiedRequestOptions
  ): PromptContext {
    return {
      system: {
        roleId: 'default',
        roleName: 'Assistant',
        systemPrompt: params.systemPrompt || '',
        variables: {
          date: new Date().toISOString().split('T')[0],
          os: process.platform,
          systemLang: process.env.LANG || 'en-US',
        },
      },
      messages: params.messages,
      tools: params.tools || [],
      metadata: {
        chatId: options?.sessionId || 'default',
        senderId: options?.userId || 'user',
        traceId: options?.metadata?.traceId as string,
        maxTokens: options?.maxTokens,
      },
    };
  }

  /**
   * 发射请求开始事件
   */
  private emitRequestStart(
    requestId: string,
    messageCount: number,
    cacheEnabled: boolean,
    stream: boolean
  ): void {
    const eventData: RequestStartEventData = {
      requestId,
      provider: this.provider,
      model: this.model,
      messageCount,
      cacheEnabled,
      stream,
      timestamp: new Date().toISOString(),
    };

    this.emit(UnifiedClientEvent.REQUEST_START, eventData);
  }

  /**
   * 发射请求完成事件
   */
  private emitRequestComplete(
    requestId: string,
    response: StandardResponse,
    latency: number,
    fromCache: boolean
  ): void {
    const eventData: RequestCompleteEventData = {
      requestId,
      provider: this.provider,
      model: this.model,
      textLength: response.text.length,
      toolCallCount: response.toolCalls.length,
      tokenUsage: response.tokenUsage,
      latency,
      fromCache,
      estimatedCost: this.metricsCollector.calculateCost(this.model, response.tokenUsage),
      timestamp: new Date().toISOString(),
    };

    this.emit(UnifiedClientEvent.REQUEST_COMPLETE, eventData);
  }

  /**
   * 发射请求错误事件
   */
  private emitRequestError(
    requestId: string,
    errorType: ErrorType,
    errorMessage: string,
    retryCount: number
  ): void {
    const eventData: RequestErrorEventData = {
      requestId,
      provider: this.provider,
      model: this.model,
      errorType,
      errorMessage,
      retryCount,
      timestamp: new Date().toISOString(),
    };

    this.emit(UnifiedClientEvent.REQUEST_ERROR, eventData);
  }

  /**
   * 发射缓存命中事件
   */
  private emitCacheHit(cacheKey: string, requestId: string): void {
    const eventData: CacheEventData = {
      cacheKey,
      requestId,
      timestamp: new Date().toISOString(),
    };

    this.emit(UnifiedClientEvent.CACHE_HIT, eventData);
  }

  /**
   * 发射缓存未命中事件
   */
  private emitCacheMiss(cacheKey: string, requestId: string): void {
    const eventData: CacheEventData = {
      cacheKey,
      requestId,
      timestamp: new Date().toISOString(),
    };

    this.emit(UnifiedClientEvent.CACHE_MISS, eventData);
  }

  /**
   * 发射重试尝试事件
   */
  private emitRetryAttempt(
    requestId: string,
    attempt: number,
    maxRetries: number,
    errorType: ErrorType,
    errorMessage: string,
    waitTime: number
  ): void {
    const eventData: RetryEventData = {
      requestId,
      attempt,
      maxRetries,
      errorType,
      errorMessage,
      waitTime,
      timestamp: new Date().toISOString(),
    };

    this.emit(UnifiedClientEvent.RETRY_ATTEMPT, eventData);
  }

  /**
   * 将数组分割为指定大小的块
   * @param array 数组
   * @param size 块大小
   * @returns 分割后的数组
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

/**
 * 创建统一 LLM 客户端实例
 * @param config 客户端配置
 * @returns 统一 LLM 客户端实例
 */
export function createUnifiedLLMClient(config: UnifiedLLMClientConfig): UnifiedLLMClient {
  return new UnifiedLLMClient(config);
}
