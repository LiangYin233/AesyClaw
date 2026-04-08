/**
 * LLM 模块类型定义
 *
 * 本文件包含 LLM 模块的所有核心类型定义，包括：
 * - 基础消息和响应类型
 * - 提供商配置和接口
 * - 统一客户端相关类型
 * - 消息和工具转换器类型
 * - 错误处理和重试策略类型
 * - 缓存管理类型
 * - 指标收集类型
 * - 请求构建和响应解析类型
 * - 流式处理类型
 *
 * @module llm/types
 */

import { PromptContext } from './prompt-context.js';
import type { ToolDefinition, ToolParameters } from '../../platform/tools/types.js';

// ============================================================================
// 基础消息和响应类型
// ============================================================================

/**
 * 消息角色枚举
 * 定义消息的发送者角色
 */
export enum MessageRole {
  /** 系统消息 - 通常用于设置助手的行为 */
  System = 'system',
  /** 用户消息 - 来自用户输入 */
  User = 'user',
  /** 助手消息 - 来自 LLM 的响应 */
  Assistant = 'assistant',
  /** 工具消息 - 工具执行结果 */
  Tool = 'tool'
}

/**
 * 标准消息格式
 * 统一的消息结构，适用于所有 LLM 提供商
 */
export interface StandardMessage {
  /** 消息角色 */
  role: MessageRole;
  /** 消息内容 */
  content: string;
  /** 工具调用列表（仅助手消息） */
  toolCalls?: ToolCall[];
  /** 工具调用 ID（仅工具消息） */
  toolCallId?: string;
  /** 工具名称（仅工具消息） */
  name?: string;
}

/**
 * 工具调用
 * 表示 LLM 发起的工具调用请求
 */
export interface ToolCall {
  /** 工具调用唯一标识 */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
}

/**
 * 工具执行结果
 * 表示工具执行后的返回结果
 */
export interface ToolResult {
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 是否执行成功 */
  success: boolean;
  /** 执行结果内容 */
  content: string;
  /** 错误信息（失败时） */
  error?: string;
}

/**
 * Token 使用统计
 * 记录请求的 Token 消耗情况
 */
export interface TokenUsage {
  /** 输入 Token 数量 */
  promptTokens: number;
  /** 输出 Token 数量 */
  completionTokens: number;
  /** 总 Token 数量 */
  totalTokens: number;
}

/**
 * 标准响应格式
 * 统一的响应结构，适用于所有 LLM 提供商
 */
export interface StandardResponse {
  /** 响应文本内容 */
  text: string;
  /** 工具调用列表 */
  toolCalls: ToolCall[];
  /** Token 使用统计 */
  tokenUsage?: TokenUsage;
  /** 结束原因 */
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
  /** 原始响应对象 */
  rawResponse?: unknown;
}

// ============================================================================
// 提供商配置和接口
// ============================================================================

/**
 * LLM 提供商类型枚举
 */
export enum LLMProviderType {
  /** OpenAI Chat Completion API */
  OpenAIChat = 'openai-chat',
  /** OpenAI Completion API（旧版） */
  OpenAICompletion = 'openai-completion',
  /** Anthropic Claude API */
  Anthropic = 'anthropic'
}

/**
 * LLM 模式枚举
 */
export enum LLMMode {
  /** 对话模式 */
  Chat = 'chat',
  /** 补全模式 */
  Completion = 'completion'
}

/**
 * LLM 提供商配置
 */
export interface LLMProviderConfig {
  /** 提供商类型 */
  provider: LLMProviderType;
  /** 模型名称 */
  model?: string;
  /** API 密钥 */
  apiKey?: string;
  /** API 基础地址 */
  baseUrl?: string;
  /** 请求超时时间（毫秒） */
  timeout?: number;
}

/**
 * LLM 提供商接口
 * 定义所有 LLM 提供商必须实现的方法
 */
export interface ILLMProvider {
  /** 提供商类型 */
  readonly providerType: LLMProviderType;
  /** 支持的模式 */
  readonly supportedModes: LLMMode[];

  /**
   * 生成响应
   * @param _context 提示上下文
   * @returns 标准响应
   */
  generate(_context: PromptContext): Promise<StandardResponse>;

  /**
   * 验证配置
   * @returns 配置是否有效
   */
  validateConfig(): boolean;
}

/**
 * 适配器工厂接口
 */
export interface IAdapterFactory {
  /**
   * 创建适配器
   * @param _config 提供商配置
   * @returns LLM 提供商实例
   */
  createAdapter(_config: LLMProviderConfig): ILLMProvider;
}

// ============================================================================
// 错误处理和重试策略类型
// ============================================================================

/**
 * 错误类型枚举
 * 用于分类不同类型的错误，决定是否需要重试
 */
export enum ErrorType {
  /** 网络错误 - 可重试 */
  NETWORK_ERROR = 'network_error',
  /** 连接重置 - 可重试 */
  CONNECTION_RESET = 'connection_reset',
  /** 连接超时 - 可重试 */
  TIMEOUT = 'timeout',
  /** DNS 解析失败 - 可重试 */
  DNS_ERROR = 'dns_error',
  /** 限流错误 - 可重试（需要等待） */
  RATE_LIMIT = 'rate_limit',
  /** 服务过载 - 可重试 */
  OVERLOADED = 'overloaded',
  /** 内部错误 - 可重试 */
  INTERNAL_ERROR = 'internal_error',
  /** 认证错误 - 不可重试 */
  AUTHENTICATION_ERROR = 'authentication_error',
  /** 授权错误 - 不可重试 */
  AUTHORIZATION_ERROR = 'authorization_error',
  /** 参数错误 - 不可重试 */
  INVALID_REQUEST = 'invalid_request',
  /** 资源未找到 - 不可重试 */
  NOT_FOUND = 'not_found',
  /** 内容过滤 - 不可重试 */
  CONTENT_FILTER = 'content_filter',
  /** 未知错误 - 默认不可重试 */
  UNKNOWN = 'unknown',
}

/**
 * 错误信息接口
 */
export interface ErrorInfo {
  /** 错误类型 */
  type: ErrorType;
  /** 原始错误对象 */
  originalError: Error;
  /** 错误消息 */
  message: string;
  /** HTTP 状态码（如果适用） */
  statusCode?: number;
  /** 错误代码 */
  code?: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 重试等待时间（毫秒，如果适用） */
  retryAfter?: number;
}

/**
 * 重试策略配置接口
 */
export interface RetryPolicy {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟时间（毫秒） */
  initialDelay: number;
  /** 最大延迟时间（毫秒） */
  maxDelay: number;
  /** 退避倍数 */
  backoffMultiplier: number;
  /** 可重试的错误类型 */
  retryableErrors: ErrorType[];
  /** 是否启用抖动（jitter）以避免重试风暴 */
  enableJitter?: boolean;
  /** 抖动因子（0-1之间） */
  jitterFactor?: number;
}

/**
 * 重试统计信息
 */
export interface RetryStats {
  /** 总尝试次数 */
  totalAttempts: number;
  /** 重试次数 */
  retryCount: number;
  /** 最后一次错误 */
  lastError?: ErrorInfo;
  /** 总等待时间（毫秒） */
  totalWaitTime: number;
}

/**
 * 重试回调函数类型
 */
export type RetryCallback = (info: {
  attempt: number;
  maxRetries: number;
  errorInfo: ErrorInfo;
  waitTime: number;
}) => void;

// ============================================================================
// 缓存管理类型
// ============================================================================

/**
 * 缓存统计信息接口
 */
export interface CacheStats {
  /** 当前缓存条目数量 */
  size: number;
  /** 最大容量 */
  maxSize: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 过期清理次数 */
  evictions: number;
  /** 总请求数 */
  totalRequests: number;
}

/**
 * 缓存配置接口
 */
export interface CacheConfig {
  /** 默认 TTL（毫秒），默认 1 小时 */
  defaultTTL?: number;
  /** 最大容量，默认 1000 */
  maxSize?: number;
  /** 清理间隔（毫秒），默认 1 分钟 */
  cleanupInterval?: number;
}

// ============================================================================
// 指标收集类型
// ============================================================================

/**
 * 模型定价信息（每 1K tokens, USD）
 */
export interface ModelPricing {
  /** 输入 token 价格（每 1K tokens） */
  prompt: number;
  /** 输出 token 价格（每 1K tokens） */
  completion: number;
}

/**
 * 单次请求指标
 */
export interface RequestMetric {
  /** 请求唯一标识 */
  requestId: string;
  /** 提供商类型 */
  provider: LLMProviderType;
  /** 模型名称 */
  model: string;
  /** 请求开始时间（ISO 字符串） */
  startTime: string;
  /** 请求结束时间（ISO 字符串） */
  endTime?: string;
  /** 请求延迟（毫秒） */
  latency?: number;
  /** Token 使用情况 */
  tokenUsage?: TokenUsage;
  /** 请求是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
  /** 错误类型（失败时） */
  errorType?: string;
  /** 预估成本（美元） */
  estimatedCost?: number;
  /** 会话 ID（可选） */
  sessionId?: string;
  /** 用户 ID（可选） */
  userId?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 错误统计指标
 */
export interface ErrorMetric {
  /** 错误类型 */
  errorType: string;
  /** 错误消息 */
  errorMessage: string;
  /** 出现次数 */
  count: number;
  /** 最后出现时间 */
  lastOccurrence: string;
  /** 关联的提供商 */
  providers: Set<LLMProviderType>;
  /** 关联的模型 */
  models: Set<string>;
}

/**
 * 按模型分组的指标
 */
export interface ModelMetrics {
  /** 模型名称 */
  model: string;
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successfulRequests: number;
  /** 失败请求数 */
  failedRequests: number;
  /** 成功率（百分比） */
  successRate: number;
  /** 平均延迟（毫秒） */
  averageLatency: number;
  /** 最小延迟（毫秒） */
  minLatency: number;
  /** 最大延迟（毫秒） */
  maxLatency: number;
  /** 总输入 Token 数 */
  totalPromptTokens: number;
  /** 总输出 Token 数 */
  totalCompletionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 预估总成本（美元） */
  estimatedCost: number;
  /** 平均每次请求成本 */
  averageCostPerRequest: number;
}

/**
 * 按提供商分组的指标
 */
export interface ProviderMetrics {
  /** 提供商类型 */
  provider: LLMProviderType;
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successfulRequests: number;
  /** 失败请求数 */
  failedRequests: number;
  /** 成功率（百分比） */
  successRate: number;
  /** 平均延迟（毫秒） */
  averageLatency: number;
  /** 总输入 Token 数 */
  totalPromptTokens: number;
  /** 总输出 Token 数 */
  totalCompletionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 预估总成本（美元） */
  estimatedCost: number;
  /** 按模型分组的详细指标 */
  models: Map<string, ModelMetrics>;
}

/**
 * 完整统计报告
 */
export interface MetricsReport {
  /** 报告生成时间 */
  generatedAt: string;
  /** 统计时间范围 */
  timeRange: {
    start: string;
    end: string;
  };
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successfulRequests: number;
  /** 失败请求数 */
  failedRequests: number;
  /** 成功率（百分比） */
  successRate: number;
  /** 平均延迟（毫秒） */
  averageLatency: number;
  /** 总输入 Token 数 */
  totalPromptTokens: number;
  /** 总输出 Token 数 */
  totalCompletionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 预估总成本（美元） */
  estimatedCost: number;
  /** 按提供商分组的指标 */
  providers: Map<LLMProviderType, ProviderMetrics>;
  /** 错误统计 */
  errors: ErrorMetric[];
}

/**
 * 指标收集器配置
 */
export interface MetricsCollectorConfig {
  /** 是否启用指标收集 */
  enabled?: boolean;
  /** 最大保存的请求数量 */
  maxRequests?: number;
  /** 是否记录详细日志 */
  verbose?: boolean;
}

// ============================================================================
// 消息转换器类型
// ============================================================================

/**
 * OpenAI 格式的系统消息
 */
export interface OpenAISystemMessage {
  role: 'system';
  content: string;
}

/**
 * 转换后的 OpenAI 消息结果
 */
export interface OpenAIConvertedMessages {
  /** 系统消息（单独传递） */
  systemMessage?: OpenAISystemMessage;
  /** 对话消息数组 */
  messages: Array<any>; // ChatCompletionMessageParam
}

/**
 * 转换后的 Anthropic 消息结果
 */
export interface AnthropicConvertedMessages {
  /** 系统提示（单独传递） */
  systemPrompt?: string;
  /** 对话消息数组 */
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<any>;
  }>;
}

/**
 * 消息格式化器接口
 */
export interface IMessageFormatter {
  /**
   * 将标准消息格式转换为特定提供商的消息格式
   * @param messages 标准消息数组
   * @param systemPrompt 系统提示（可选）
   * @returns 转换后的消息格式
   */
  format(messages: StandardMessage[], systemPrompt?: string): unknown;
}

// ============================================================================
// 工具转换器类型
// ============================================================================

/**
 * OpenAI 工具定义格式
 * 符合 OpenAI function calling 规范
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolParameters;
  };
}

/**
 * Anthropic 工具定义格式
 * 符合 Anthropic tool use 规范
 */
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: ToolParameters;
}

/**
 * 工具格式化器接口
 * 定义工具转换的通用接口
 */
export interface ToolFormatter<T> {
  /**
   * 将通用工具定义转换为特定提供商的格式
   * @param tool 通用工具定义
   * @returns 特定提供商的工具定义
   */
  format(tool: ToolDefinition): T;

  /**
   * 批量转换工具定义
   * @param tools 通用工具定义数组
   * @returns 特定提供商的工具定义数组
   */
  formatAll(tools: ToolDefinition[]): T[];
}

// ============================================================================
// 请求构建器类型
// ============================================================================

/**
 * 请求选项配置
 * 定义通用的请求参数
 */
export interface RequestOptions {
  /** 温度参数，控制输出的随机性 (0-2) */
  temperature?: number;
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** Top-p 采样参数 (0-1) */
  topP?: number;
  /** 停止序列 */
  stopSequences?: string[];
  /** 频率惩罚 (-2.0 到 2.0) */
  frequencyPenalty?: number;
  /** 存在惩罚 (-2.0 到 2.0) */
  presencePenalty?: number;
  /** 是否流式输出 */
  stream?: boolean;
  /** 用户标识符 */
  user?: string;
  /** 种子值，用于可重复性输出 */
  seed?: number;
  /** 响应格式 */
  responseFormat?: { type: 'text' | 'json_object' };
  /** 自定义参数 */
  customParams?: Record<string, unknown>;
}

/**
 * OpenAI 标准请求格式
 */
export interface OpenAIStandardRequest {
  /** 模型名称 */
  model: string;
  /** 消息数组 */
  messages: any[];
  /** 工具定义 */
  tools?: OpenAIToolDefinition[];
  /** 工具选择策略 */
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** 温度 */
  temperature?: number;
  /** 最大 token 数 */
  max_tokens?: number;
  /** Top-p */
  top_p?: number;
  /** 停止序列 */
  stop?: string[];
  /** 频率惩罚 */
  frequency_penalty?: number;
  /** 存在惩罚 */
  presence_penalty?: number;
  /** 流式输出 */
  stream?: boolean;
  /** 用户标识 */
  user?: string;
  /** 种子 */
  seed?: number;
  /** 响应格式 */
  response_format?: { type: 'text' | 'json_object' };
}

/**
 * OpenAI 流式请求格式
 */
export interface OpenAIStreamRequest extends OpenAIStandardRequest {
  stream: true;
  /** 流式选项 */
  stream_options?: {
    include_usage?: boolean;
  };
}

/**
 * Anthropic 标准请求格式
 */
export interface AnthropicStandardRequest {
  /** 模型名称 */
  model: string;
  /** 系统提示（单独传递） */
  system?: string;
  /** 消息数组 */
  messages: any[];
  /** 工具定义 */
  tools?: AnthropicToolDefinition[];
  /** 最大 token 数 */
  max_tokens: number;
  /** 温度 */
  temperature?: number;
  /** Top-p */
  top_p?: number;
  /** 停止序列 */
  stop_sequences?: string[];
  /** 流式输出 */
  stream?: boolean;
  /** 用户标识 */
  metadata?: {
    user_id?: string;
  };
}

/**
 * Anthropic 流式请求格式
 */
export interface AnthropicStreamRequest extends AnthropicStandardRequest {
  stream: true;
}

/**
 * 标准请求联合类型
 */
export type StandardRequest =
  | { provider: LLMProviderType.OpenAIChat | LLMProviderType.OpenAICompletion; request: OpenAIStandardRequest }
  | { provider: LLMProviderType.Anthropic; request: AnthropicStandardRequest };

/**
 * 流式请求联合类型
 */
export type StreamRequest =
  | { provider: LLMProviderType.OpenAIChat | LLMProviderType.OpenAICompletion; request: OpenAIStreamRequest }
  | { provider: LLMProviderType.Anthropic; request: AnthropicStreamRequest };

/**
 * 请求构建器配置
 */
export interface RequestBuilderConfig {
  /** 提供商类型 */
  providerType: LLMProviderType;
  /** 模型名称 */
  model: string;
  /** 默认请求选项 */
  defaultOptions?: RequestOptions;
}

/**
 * 请求验证结果
 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误信息列表 */
  errors: string[];
  /** 警告信息列表 */
  warnings: string[];
}

// ============================================================================
// 响应解析器类型
// ============================================================================

/**
 * OpenAI Chat Completion 响应类型
 */
export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Anthropic Messages 响应类型
 */
export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * 支持的提供商类型（响应解析器）
 */
export type ProviderType = 'openai' | 'anthropic';

// ============================================================================
// 流式处理类型
// ============================================================================

/**
 * OpenAI 流式响应块类型
 */
export interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Anthropic 流式响应块类型
 */
export interface AnthropicStreamChunk {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
  message?: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: Array<{
      type: 'text' | 'tool_use';
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    model: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  index?: number;
  content_block?: {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type?: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
  usage?: {
    output_tokens: number;
  };
}

/**
 * 统一的流式响应块类型
 */
export type StreamChunk = OpenAIStreamChunk | AnthropicStreamChunk;

/**
 * 流式处理器的配置选项
 */
export interface StreamHandlerOptions {
  /** 提供商类型 */
  provider: 'openai' | 'anthropic';
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * 流式处理器的输出项
 */
export interface StreamOutput {
  /** 文本内容 */
  text?: string;
  /** 工具调用 */
  toolCall?: ToolCall;
  /** 是否完成 */
  done: boolean;
  /** Token 使用统计 */
  tokenUsage?: TokenUsage;
  /** 结束原因 */
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
}

// ============================================================================
// 统一 LLM 客户端类型
// ============================================================================

/**
 * 统一 LLM 客户端配置接口
 */
export interface UnifiedLLMClientConfig {
  /** 提供商类型 */
  provider: LLMProviderType;
  /** 模型名称 */
  model: string;
  /** API 密钥 */
  apiKey?: string;
  /** API 基础地址 */
  baseUrl?: string;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 重试策略 */
  retryPolicy?: Partial<RetryPolicy>;
  /** 缓存配置 */
  cacheConfig?: CacheConfig;
  /** 是否启用缓存 */
  cacheEnabled?: boolean;
  /** 是否启用流式输出 */
  streamEnabled?: boolean;
  /** 指标收集配置 */
  metricsConfig?: MetricsCollectorConfig;
  /** 默认请求选项 */
  defaultOptions?: RequestOptions;
}

/**
 * 统一请求选项接口
 */
export interface UnifiedRequestOptions extends RequestOptions {
  /** 是否启用缓存（覆盖全局配置） */
  cacheEnabled?: boolean;
  /** 缓存 TTL（毫秒） */
  cacheTTL?: number;
  /** 会话 ID */
  sessionId?: string;
  /** 用户 ID */
  userId?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 批量请求项
 */
export interface BatchRequestItem {
  /** 请求 ID */
  id: string;
  /** 消息数组 */
  messages: StandardMessage[];
  /** 系统提示 */
  systemPrompt?: string;
  /** 工具定义 */
  tools?: ToolDefinition[];
  /** 请求选项 */
  options?: UnifiedRequestOptions;
}

/**
 * 批量请求结果
 */
export interface BatchRequestResult {
  /** 请求 ID */
  id: string;
  /** 响应结果 */
  response?: StandardResponse;
  /** 错误信息 */
  error?: Error;
  /** 是否成功 */
  success: boolean;
}

/**
 * 流式响应回调
 */
export interface StreamCallbacks {
  /** 接收到 token 时的回调 */
  onToken?: (text: string) => void;
  /** 接收到工具调用时的回调 */
  onToolCall?: (toolCall: ToolCall) => void;
  /** 流式响应完成时的回调 */
  onComplete?: (result: {
    text: string;
    toolCalls: ToolCall[];
    tokenUsage?: TokenUsage;
    finishReason: string;
  }) => void;
  /** 发生错误时的回调 */
  onError?: (error: Error) => void;
}

/**
 * 统一 LLM 客户端事件类型
 */
export enum UnifiedClientEvent {
  /** 请求开始 */
  REQUEST_START = 'request:start',
  /** 请求完成 */
  REQUEST_COMPLETE = 'request:complete',
  /** 请求失败 */
  REQUEST_ERROR = 'request:error',
  /** 缓存命中 */
  CACHE_HIT = 'cache:hit',
  /** 缓存未命中 */
  CACHE_MISS = 'cache:miss',
  /** 重试尝试 */
  RETRY_ATTEMPT = 'retry:attempt',
  /** 重试开始 */
  RETRY_START = 'retry:start',
  /** 重试成功 */
  RETRY_SUCCESS = 'retry:success',
}

/**
 * 请求开始事件数据
 */
export interface RequestStartEventData {
  /** 请求 ID */
  requestId: string;
  /** 提供商类型 */
  provider: LLMProviderType;
  /** 模型名称 */
  model: string;
  /** 消息数量 */
  messageCount: number;
  /** 是否启用缓存 */
  cacheEnabled: boolean;
  /** 是否流式 */
  stream: boolean;
  /** 时间戳 */
  timestamp: string;
}

/**
 * 请求完成事件数据
 */
export interface RequestCompleteEventData {
  /** 请求 ID */
  requestId: string;
  /** 提供商类型 */
  provider: LLMProviderType;
  /** 模型名称 */
  model: string;
  /** 响应文本长度 */
  textLength: number;
  /** 工具调用数量 */
  toolCallCount: number;
  /** Token 使用统计 */
  tokenUsage?: TokenUsage;
  /** 延迟（毫秒） */
  latency: number;
  /** 是否来自缓存 */
  fromCache: boolean;
  /** 预估成本 */
  estimatedCost?: number;
  /** 时间戳 */
  timestamp: string;
}

/**
 * 请求错误事件数据
 */
export interface RequestErrorEventData {
  /** 请求 ID */
  requestId: string;
  /** 提供商类型 */
  provider: LLMProviderType;
  /** 模型名称 */
  model: string;
  /** 错误类型 */
  errorType: ErrorType;
  /** 错误消息 */
  errorMessage: string;
  /** 重试次数 */
  retryCount: number;
  /** 时间戳 */
  timestamp: string;
}

/**
 * 缓存事件数据
 */
export interface CacheEventData {
  /** 缓存键 */
  cacheKey: string;
  /** 请求 ID */
  requestId: string;
  /** 时间戳 */
  timestamp: string;
}

/**
 * 重试事件数据
 */
export interface RetryEventData {
  /** 请求 ID */
  requestId: string;
  /** 当前尝试次数 */
  attempt: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 错误类型 */
  errorType: ErrorType;
  /** 错误消息 */
  errorMessage: string;
  /** 等待时间（毫秒） */
  waitTime: number;
  /** 时间戳 */
  timestamp: string;
}

// ============================================================================
// 类型别名
// ============================================================================

/**
 * LLM 客户端通用配置
 * 用于创建 LLM 客户端的简化配置
 */
export type LLMClientConfig = Omit<UnifiedLLMClientConfig, 'provider' | 'model'> & {
  /** 提供商类型 */
  provider?: LLMProviderType;
  /** 模型名称 */
  model?: string;
};

/**
 * 生成参数
 * 用于 generate 方法的参数
 */
export interface GenerateParams {
  /** 消息数组 */
  messages: StandardMessage[];
  /** 系统提示 */
  systemPrompt?: string;
  /** 工具定义 */
  tools?: ToolDefinition[];
}

/**
 * 流式生成参数
 * 用于 generateStream 方法的参数
 */
export type StreamGenerateParams = GenerateParams;

/**
 * 批量生成参数
 * 用于 generateBatch 方法的参数
 */
export interface BatchGenerateParams {
  /** 批量请求项 */
  items: BatchRequestItem[];
  /** 并发数量 */
  concurrency?: number;
}
