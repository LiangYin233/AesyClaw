/**
 * MetricsCollector 集成示例
 * 展示如何在现有 LLM 适配器中集成指标收集功能
 */

import { ILLMProvider, LLMProviderType, LLMMode, StandardResponse, TokenUsage } from '../types.js';
import { PromptContext } from '../prompt-context.js';
import { MetricsCollector } from './metrics-collector.js';
import { logger } from '../../../platform/observability/logger.js';

/**
 * 带指标收集的 LLM 提供商包装器
 * 可以包装任何现有的 ILLMProvider 实现
 */
export class MetricsEnabledProvider implements ILLMProvider {
  readonly providerType: LLMProviderType;
  readonly supportedModes: LLMMode[];

  private wrappedProvider: ILLMProvider;
  private metricsCollector: MetricsCollector;
  private model: string;

  constructor(
    provider: ILLMProvider,
    model: string,
    metricsCollector: MetricsCollector
  ) {
    this.wrappedProvider = provider;
    this.providerType = provider.providerType;
    this.supportedModes = provider.supportedModes;
    this.model = model;
    this.metricsCollector = metricsCollector;
  }

  /**
   * 生成响应并自动收集指标
   */
  async generate(context: PromptContext): Promise<StandardResponse> {
    // 开始记录请求
    const requestId = this.metricsCollector.startRequest(
      this.providerType,
      this.model,
      {
        chatId: context.metadata?.chatId,
        senderId: context.metadata?.senderId,
        traceId: context.metadata?.traceId,
        messageCount: context.messages.length,
        toolCount: context.tools.length,
      }
    );

    try {
      // 调用原始提供商
      const response = await this.wrappedProvider.generate(context);

      // 记录成功
      this.metricsCollector.recordSuccess(
        requestId,
        response.tokenUsage,
        {
          finishReason: response.finishReason,
          hasToolCalls: response.toolCalls.length > 0,
          toolCallCount: response.toolCalls.length,
        }
      );

      return response;
    } catch (error) {
      // 记录错误
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

      this.metricsCollector.recordError(requestId, errorMessage, errorType);

      logger.error(
        {
          provider: this.providerType,
          model: this.model,
          error: errorMessage,
          errorType,
        },
        'LLM 请求失败'
      );

      throw error;
    }
  }

  validateConfig(): boolean {
    return this.wrappedProvider.validateConfig();
  }
}

/**
 * 创建带指标收集的提供商工厂函数
 */
export function createMetricsEnabledProvider(
  provider: ILLMProvider,
  model: string,
  metricsCollector: MetricsCollector
): ILLMProvider {
  return new MetricsEnabledProvider(provider, model, metricsCollector);
}

/**
 * 使用示例：
 *
 * ```typescript
 * import { OpenAIChatAdapter } from '../adapters/openai-chat-adapter.js';
 * import { MetricsCollector, createMetricsEnabledProvider } from '../metrics/index.js';
 *
 * // 创建指标收集器
 * const metricsCollector = new MetricsCollector({ verbose: true });
 *
 * // 创建原始适配器
 * const openaiAdapter = new OpenAIChatAdapter({
 *   provider: LLMProviderType.OpenAIChat,
 *   model: 'gpt-4o',
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 *
 * // 包装为带指标收集的适配器
 * const metricsEnabledAdapter = createMetricsEnabledProvider(
 *   openaiAdapter,
 *   'gpt-4o',
 *   metricsCollector
 * );
 *
 * // 使用适配器（指标会自动收集）
 * const response = await metricsEnabledAdapter.generate(context);
 *
 * // 获取指标报告
 * const report = metricsCollector.getMetricsReport();
 * console.log(`成功率: ${report.successRate}%`);
 * console.log(`预估成本: $${report.estimatedCost}`);
 * ```
 */

/**
 * 全局指标收集器实例
 * 可以在整个应用中共享使用
 */
let globalMetricsCollector: MetricsCollector | null = null;

/**
 * 获取全局指标收集器实例
 */
export function getGlobalMetricsCollector(): MetricsCollector {
  if (!globalMetricsCollector) {
    globalMetricsCollector = new MetricsCollector({ verbose: true });
  }
  return globalMetricsCollector;
}

/**
 * 设置全局指标收集器实例
 */
export function setGlobalMetricsCollector(collector: MetricsCollector): void {
  globalMetricsCollector = collector;
}

/**
 * 重置全局指标收集器
 */
export function resetGlobalMetricsCollector(): void {
  if (globalMetricsCollector) {
    globalMetricsCollector.clear();
  }
  globalMetricsCollector = null;
}
