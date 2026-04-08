/**
 * 请求构建器模块
 * 用于构建发送给不同 LLM 提供商的请求
 */

import {
  LLMProviderType,
  StandardMessage,
} from '../types.js';
import {
  MessageTransformer,
  OpenAIConvertedMessages,
  AnthropicConvertedMessages,
} from '../transformers/message-transformer.js';
import {
  ToolTransformer,
  OpenAIToolDefinition,
  AnthropicToolDefinition,
} from '../transformers/tool-transformer.js';
import type { ToolDefinition } from '../../../platform/tools/types.js';
import { logger } from '../../../platform/observability/logger.js';

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
 * 默认请求选项
 */
const DEFAULT_OPTIONS: RequestOptions = {
  temperature: 0.7,
  maxTokens: 4096,
  topP: 1,
  stream: false,
};

/**
 * OpenAI 标准请求格式
 */
export interface OpenAIStandardRequest {
  /** 模型名称 */
  model: string;
  /** 消息数组 */
  messages: OpenAIConvertedMessages['messages'];
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
  messages: AnthropicConvertedMessages['messages'];
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

/**
 * 请求构建器
 * 用于构建发送给不同 LLM 提供商的请求
 *
 * 使用示例：
 * ```typescript
 * const builder = new RequestBuilder({
 *   providerType: LLMProviderType.OpenAIChat,
 *   model: 'gpt-4o-mini',
 * });
 *
 * const request = builder.build({
 *   messages: standardMessages,
 *   systemPrompt: 'You are a helpful assistant.',
 *   tools: toolDefinitions,
 *   options: { temperature: 0.8, maxTokens: 2048 },
 * });
 * ```
 */
export class RequestBuilder {
  private readonly providerType: LLMProviderType;
  private readonly model: string;
  private readonly defaultOptions: RequestOptions;
  private readonly messageTransformer: MessageTransformer;
  private readonly toolTransformer: ToolTransformer;

  /**
   * 创建请求构建器实例
   * @param config 构建器配置
   */
  constructor(config: RequestBuilderConfig) {
    this.providerType = config.providerType;
    this.model = config.model;
    this.defaultOptions = { ...DEFAULT_OPTIONS, ...config.defaultOptions };
    this.messageTransformer = new MessageTransformer();
    this.toolTransformer = new ToolTransformer();

    logger.debug(
      {
        providerType: this.providerType,
        model: this.model,
        defaultOptions: this.defaultOptions,
      },
      '请求构建器已初始化'
    );
  }

  /**
   * 构建标准请求
   * @param params 构建参数
   * @returns 标准请求对象
   */
  build(params: {
    messages: StandardMessage[];
    systemPrompt?: string;
    tools?: ToolDefinition[];
    options?: RequestOptions;
  }): StandardRequest {
    // 合并选项
    const mergedOptions = this.mergeOptions(params.options);

    // 验证请求参数
    const validation = this.validate(params.messages, mergedOptions);
    if (!validation.valid) {
      throw new Error(`请求验证失败: ${validation.errors.join(', ')}`);
    }

    // 根据提供商类型构建请求
    switch (this.providerType) {
      case LLMProviderType.OpenAIChat:
      case LLMProviderType.OpenAICompletion:
        return this.buildOpenAIRequest(params, mergedOptions);

      case LLMProviderType.Anthropic:
        return this.buildAnthropicRequest(params, mergedOptions);

      default:
        throw new Error(`不支持的提供商类型: ${this.providerType}`);
    }
  }

  /**
   * 构建流式请求
   * @param params 构建参数
   * @returns 流式请求对象
   */
  buildStream(params: {
    messages: StandardMessage[];
    systemPrompt?: string;
    tools?: ToolDefinition[];
    options?: RequestOptions;
  }): StreamRequest {
    // 强制设置 stream 为 true
    const streamOptions: RequestOptions = {
      ...params.options,
      stream: true,
    };

    // 合并选项
    const mergedOptions = this.mergeOptions(streamOptions);

    // 验证请求参数
    const validation = this.validate(params.messages, mergedOptions);
    if (!validation.valid) {
      throw new Error(`请求验证失败: ${validation.errors.join(', ')}`);
    }

    // 根据提供商类型构建请求
    switch (this.providerType) {
      case LLMProviderType.OpenAIChat:
      case LLMProviderType.OpenAICompletion:
        return this.buildOpenAIStreamRequest(params, mergedOptions);

      case LLMProviderType.Anthropic:
        return this.buildAnthropicStreamRequest(params, mergedOptions);

      default:
        throw new Error(`不支持的提供商类型: ${this.providerType}`);
    }
  }

  /**
   * 验证请求参数
   * @param messages 消息数组
   * @param options 请求选项
   * @returns 验证结果
   */
  validate(
    messages: StandardMessage[],
    options: RequestOptions
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证消息
    const messageValidation = this.messageTransformer.validate(messages);
    errors.push(...messageValidation.errors);

    // 验证选项范围
    if (options.temperature !== undefined) {
      if (options.temperature < 0 || options.temperature > 2) {
        errors.push('temperature 必须在 0 到 2 之间');
      }
    }

    if (options.topP !== undefined) {
      if (options.topP < 0 || options.topP > 1) {
        errors.push('topP 必须在 0 到 1 之间');
      }
    }

    if (options.maxTokens !== undefined) {
      if (options.maxTokens < 1) {
        errors.push('maxTokens 必须大于 0');
      }
    }

    if (options.frequencyPenalty !== undefined) {
      if (options.frequencyPenalty < -2 || options.frequencyPenalty > 2) {
        errors.push('frequencyPenalty 必须在 -2 到 2 之间');
      }
    }

    if (options.presencePenalty !== undefined) {
      if (options.presencePenalty < -2 || options.presencePenalty > 2) {
        errors.push('presencePenalty 必须在 -2 到 2 之间');
      }
    }

    // 验证消息序列
    if (messages.length === 0) {
      errors.push('消息数组不能为空');
    }

    // 检查消息顺序是否合理
    for (let i = 0; i < messages.length - 1; i++) {
      const current = messages[i];
      const next = messages[i + 1];

      // 检查是否有连续的助手消息
      if (current.role === 'assistant' && next.role === 'assistant') {
        warnings.push(`消息 ${i} 和 ${i + 1} 都是助手消息，可能影响对话连贯性`);
      }
    }

    // 提供商特定验证
    if (this.providerType === LLMProviderType.Anthropic) {
      // Anthropic 要求 max_tokens
      if (!options.maxTokens) {
        warnings.push('Anthropic 要求设置 maxTokens，将使用默认值');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 合并请求选项
   * @param customOptions 自定义选项
   * @returns 合并后的选项
   */
  mergeOptions(customOptions?: RequestOptions): RequestOptions {
    return {
      ...this.defaultOptions,
      ...customOptions,
    };
  }

  /**
   * 构建 OpenAI 标准请求
   */
  private buildOpenAIRequest(
    params: {
      messages: StandardMessage[];
      systemPrompt?: string;
      tools?: ToolDefinition[];
    },
    options: RequestOptions
  ): StandardRequest {
    // 转换消息
    const convertedMessages = this.messageTransformer.toOpenAI(
      params.messages,
      params.systemPrompt
    );

    // 构建消息数组（包含系统消息）
    const messages = convertedMessages.systemMessage
      ? [convertedMessages.systemMessage, ...convertedMessages.messages]
      : convertedMessages.messages;

    // 转换工具
    const tools = params.tools && params.tools.length > 0
      ? this.toolTransformer.toOpenAI(params.tools)
      : undefined;

    // 构建请求
    const request: OpenAIStandardRequest = {
      model: this.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      stop: options.stopSequences,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      stream: options.stream,
      user: options.user,
      seed: options.seed,
      response_format: options.responseFormat,
    };

    // 添加工具相关字段
    if (tools && tools.length > 0) {
      request.tools = tools;
      request.tool_choice = 'auto';
    }

    // 添加自定义参数
    if (options.customParams) {
      Object.assign(request, options.customParams);
    }

    logger.debug(
      {
        provider: this.providerType,
        model: this.model,
        messageCount: messages.length,
        hasTools: !!tools,
        toolCount: tools?.length || 0,
      },
      'OpenAI 标准请求构建完成'
    );

    return {
      provider: this.providerType as LLMProviderType.OpenAIChat | LLMProviderType.OpenAICompletion,
      request,
    } as StandardRequest;
  }

  /**
   * 构建 OpenAI 流式请求
   */
  private buildOpenAIStreamRequest(
    params: {
      messages: StandardMessage[];
      systemPrompt?: string;
      tools?: ToolDefinition[];
    },
    options: RequestOptions
  ): StreamRequest {
    // 转换消息
    const convertedMessages = this.messageTransformer.toOpenAI(
      params.messages,
      params.systemPrompt
    );

    // 构建消息数组
    const messages = convertedMessages.systemMessage
      ? [convertedMessages.systemMessage, ...convertedMessages.messages]
      : convertedMessages.messages;

    // 转换工具
    const tools = params.tools && params.tools.length > 0
      ? this.toolTransformer.toOpenAI(params.tools)
      : undefined;

    // 构建流式请求
    const request: OpenAIStreamRequest = {
      model: this.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      stop: options.stopSequences,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      stream: true,
      stream_options: {
        include_usage: true,
      },
      user: options.user,
      seed: options.seed,
      response_format: options.responseFormat,
    };

    // 添加工具相关字段
    if (tools && tools.length > 0) {
      request.tools = tools;
      request.tool_choice = 'auto';
    }

    // 添加自定义参数
    if (options.customParams) {
      Object.assign(request, options.customParams);
    }

    logger.debug(
      {
        provider: this.providerType,
        model: this.model,
        messageCount: messages.length,
        hasTools: !!tools,
        stream: true,
      },
      'OpenAI 流式请求构建完成'
    );

    return {
      provider: this.providerType as LLMProviderType.OpenAIChat | LLMProviderType.OpenAICompletion,
      request,
    } as StreamRequest;
  }

  /**
   * 构建 Anthropic 标准请求
   */
  private buildAnthropicRequest(
    params: {
      messages: StandardMessage[];
      systemPrompt?: string;
      tools?: ToolDefinition[];
    },
    options: RequestOptions
  ): StandardRequest {
    // 转换消息（系统提示单独传递）
    const convertedMessages = this.messageTransformer.toAnthropic(
      params.messages,
      params.systemPrompt
    );

    // 转换工具
    const tools = params.tools && params.tools.length > 0
      ? this.toolTransformer.toAnthropic(params.tools)
      : undefined;

    // 构建请求
    const request: AnthropicStandardRequest = {
      model: this.model,
      system: convertedMessages.systemPrompt,
      messages: convertedMessages.messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
      top_p: options.topP,
      stop_sequences: options.stopSequences,
      stream: options.stream,
    };

    // 添加工具
    if (tools && tools.length > 0) {
      request.tools = tools;
    }

    // 添加用户标识
    if (options.user) {
      request.metadata = {
        user_id: options.user,
      };
    }

    // 添加自定义参数
    if (options.customParams) {
      Object.assign(request, options.customParams);
    }

    logger.debug(
      {
        provider: this.providerType,
        model: this.model,
        messageCount: convertedMessages.messages.length,
        hasSystemPrompt: !!convertedMessages.systemPrompt,
        hasTools: !!tools,
        toolCount: tools?.length || 0,
      },
      'Anthropic 标准请求构建完成'
    );

    return {
      provider: LLMProviderType.Anthropic,
      request,
    };
  }

  /**
   * 构建 Anthropic 流式请求
   */
  private buildAnthropicStreamRequest(
    params: {
      messages: StandardMessage[];
      systemPrompt?: string;
      tools?: ToolDefinition[];
    },
    options: RequestOptions
  ): StreamRequest {
    // 转换消息
    const convertedMessages = this.messageTransformer.toAnthropic(
      params.messages,
      params.systemPrompt
    );

    // 转换工具
    const tools = params.tools && params.tools.length > 0
      ? this.toolTransformer.toAnthropic(params.tools)
      : undefined;

    // 构建流式请求
    const request: AnthropicStreamRequest = {
      model: this.model,
      system: convertedMessages.systemPrompt,
      messages: convertedMessages.messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
      top_p: options.topP,
      stop_sequences: options.stopSequences,
      stream: true,
    };

    // 添加工具
    if (tools && tools.length > 0) {
      request.tools = tools;
    }

    // 添加用户标识
    if (options.user) {
      request.metadata = {
        user_id: options.user,
      };
    }

    // 添加自定义参数
    if (options.customParams) {
      Object.assign(request, options.customParams);
    }

    logger.debug(
      {
        provider: this.providerType,
        model: this.model,
        messageCount: convertedMessages.messages.length,
        hasSystemPrompt: !!convertedMessages.systemPrompt,
        hasTools: !!tools,
        stream: true,
      },
      'Anthropic 流式请求构建完成'
    );

    return {
      provider: LLMProviderType.Anthropic,
      request,
    };
  }

  /**
   * 获取提供商类型
   */
  getProviderType(): LLMProviderType {
    return this.providerType;
  }

  /**
   * 获取模型名称
   */
  getModel(): string {
    return this.model;
  }

  /**
   * 获取默认选项
   */
  getDefaultOptions(): RequestOptions {
    return { ...this.defaultOptions };
  }
}

/**
 * 创建请求构建器工厂函数
 * @param config 构建器配置
 * @returns 请求构建器实例
 */
export function createRequestBuilder(config: RequestBuilderConfig): RequestBuilder {
  return new RequestBuilder(config);
}
