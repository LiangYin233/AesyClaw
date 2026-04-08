/**
 * 统一 LLM 客户端模块导出
 * 提供统一的 LLM 调用接口和类型定义
 */

// 导出统一客户端
export {
  UnifiedLLMClient,
  createUnifiedLLMClient,
} from './unified-client.js';

// 导出错误处理器
export {
  ErrorHandler,
  DEFAULT_RETRY_POLICY,
} from './error/error-handler.js';

// 导出缓存管理器
export { CacheManager } from './cache/cache-manager.js';

// 导出指标收集器
export {
  MetricsCollector,
  MODEL_PRICING,
} from './metrics/metrics-collector.js';

// 导出流式处理器
export {
  StreamHandler,
  createOpenAIStreamHandler,
  createAnthropicStreamHandler,
  handleStream,
  handleOpenAIStream,
  handleAnthropicStream,
} from './stream/stream-handler.js';

// 导出消息转换器
export {
  MessageTransformer,
  OpenAIMessageFormatter,
  AnthropicMessageFormatter,
} from './transformers/message-transformer.js';

// 导出工具转换器
export {
  ToolTransformer,
} from './transformers/tool-transformer.js';

// 导出所有类型（从 types.ts 统一导出）
export {
  // 枚举
  LLMProviderType,
  LLMMode,
  MessageRole,
  ErrorType,
  UnifiedClientEvent,

  // 基础类型
  type StandardMessage,
  type StandardResponse,
  type ToolCall,
  type TokenUsage,
  type ToolResult,
  type ILLMProvider,
  type LLMProviderConfig,

  // 错误处理类型
  type ErrorInfo,
  type RetryPolicy,
  type RetryStats,
  type RetryCallback,

  // 缓存类型
  type CacheConfig,
  type CacheStats,

  // 指标类型
  type MetricsCollectorConfig,
  type MetricsReport,
  type RequestMetric,
  type ModelMetrics,
  type ProviderMetrics,
  type ErrorMetric,
  type ModelPricing,

  // 消息转换器类型
  type IMessageFormatter,
  type OpenAIConvertedMessages,
  type AnthropicConvertedMessages,
  type OpenAISystemMessage,

  // 工具转换器类型
  type OpenAIToolDefinition,
  type AnthropicToolDefinition,
  type ToolFormatter,

  // 请求选项
  type RequestOptions,

  // 流式处理类型
  type StreamHandlerOptions,
  type StreamOutput,
  type StreamChunk,
  type OpenAIStreamChunk,
  type AnthropicStreamChunk,

  // 统一客户端类型
  type UnifiedLLMClientConfig,
  type UnifiedRequestOptions,
  type BatchRequestItem,
  type BatchRequestResult,
  type StreamCallbacks,
  type RequestStartEventData,
  type RequestCompleteEventData,
  type RequestErrorEventData,
  type CacheEventData,
  type RetryEventData,

  type LLMClientConfig,
  type GenerateParams,
  type StreamGenerateParams,
  type BatchGenerateParams,
} from './types.js';

// 导出工具类型（从平台工具模块）
export type {
  ToolDefinition,
  ToolParameters,
} from '../../platform/tools/types.js';