/**
 * 响应解析器模块
 * 用于解析不同 LLM 提供商的响应，统一转换为 StandardResponse 格式
 */

import {
  StandardResponse,
  ToolCall,
  TokenUsage,
} from '../types.js';
import { FinishReasonMapper } from '../utils/finish-reason-mapper.js';
import { TokenUsageMapper } from '../utils/token-usage-mapper.js';

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
 * 支持的提供商类型
 */
export type ProviderType = 'openai' | 'anthropic';

/**
 * 响应解析器类
 * 负责将不同 LLM 提供商的响应统一转换为 StandardResponse 格式
 */
export class ResponseParser {
  /**
   * 解析原始响应为标准格式
   * @param provider 提供商类型
   * @param response 原始响应对象
   * @returns 标准响应格式
   */
  static parse(provider: ProviderType, response: unknown): StandardResponse {
    switch (provider) {
      case 'openai':
        return this.parseOpenAI(response as OpenAIResponse);
      case 'anthropic':
        return this.parseAnthropic(response as AnthropicResponse);
      default:
        throw new Error(`不支持的提供商类型: ${provider}`);
    }
  }

  /**
   * 解析 OpenAI 响应
   * @param response OpenAI 原始响应
   * @returns 标准响应格式
   */
  static parseOpenAI(response: OpenAIResponse): StandardResponse {
    // 验证响应结构
    if (!response.choices || response.choices.length === 0) {
      throw new Error('OpenAI 响应缺少 choices 字段或 choices 为空');
    }

    const choice = response.choices[0];
    const message = choice.message;

    // 提取文本内容
    const text = message.content || '';

    // 提取工具调用
    const toolCalls = this.extractToolCallsFromOpenAI(message.tool_calls);

    // 提取 Token 使用统计
    const tokenUsage = this.extractTokenUsageFromOpenAI(response.usage);

    // 映射 finish_reason
    const finishReason = FinishReasonMapper.fromOpenAI(choice.finish_reason);

    return {
      text,
      toolCalls,
      tokenUsage,
      finishReason,
      rawResponse: response,
    };
  }

  /**
   * 解析 Anthropic 响应
   * @param response Anthropic 原始响应
   * @returns 标准响应格式
   */
  static parseAnthropic(response: AnthropicResponse): StandardResponse {
    // 验证响应结构
    if (!response.content || response.content.length === 0) {
      throw new Error('Anthropic 响应缺少 content 字段或 content 为空');
    }

    // 提取文本内容和工具调用
    const { text, toolCalls } = this.extractContentFromAnthropic(response.content);

    // 提取 Token 使用统计
    const tokenUsage = this.extractTokenUsageFromAnthropic(response.usage);

    // 映射 stop_reason
    const finishReason = FinishReasonMapper.fromAnthropic(response.stop_reason);

    return {
      text,
      toolCalls,
      tokenUsage,
      finishReason,
      rawResponse: response,
    };
  }

  /**
   * 从 OpenAI 响应中提取工具调用
   * @param toolCalls OpenAI 工具调用数组
   * @returns 标准工具调用数组
   */
  private static extractToolCallsFromOpenAI(
    toolCalls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>
  ): ToolCall[] {
    if (!toolCalls || toolCalls.length === 0) {
      return [];
    }

    const result: ToolCall[] = [];
    for (const tc of toolCalls) {
      if (tc.type === 'function') {
        try {
          result.push({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          });
        } catch (error) {
          // 如果解析失败，记录错误并跳过该工具调用
          console.error(`解析 OpenAI 工具调用参数失败: ${tc.id}`, error);
        }
      }
    }

    return result;
  }

  /**
   * 从 Anthropic 响应中提取文本内容和工具调用
   * @param content Anthropic 内容块数组
   * @returns 文本内容和工具调用
   */
  private static extractContentFromAnthropic(
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >
  ): { text: string; toolCalls: ToolCall[] } {
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    return {
      text: text.trim(),
      toolCalls,
    };
  }

  /**
   * 从 OpenAI 响应中提取 Token 使用统计
   * @param usage OpenAI usage 对象
   * @returns Token 使用统计
   */
  private static extractTokenUsageFromOpenAI(usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }): TokenUsage | undefined {
    if (!usage) {
      return undefined;
    }
    return TokenUsageMapper.fromOpenAI(usage);
  }

  /**
   * 从 Anthropic 响应中提取 Token 使用统计
   * @param usage Anthropic usage 对象
   * @returns Token 使用统计
   */
  private static extractTokenUsageFromAnthropic(usage?: {
    input_tokens: number;
    output_tokens: number;
  }): TokenUsage | undefined {
    if (!usage) {
      return undefined;
    }
    return TokenUsageMapper.fromAnthropic(usage);
  }

  /**
   * 提取工具调用（公共方法）
   * @param provider 提供商类型
   * @param response 原始响应对象
   * @returns 工具调用数组
   */
  static extractToolCalls(provider: ProviderType, response: unknown): ToolCall[] {
    const standardResponse = this.parse(provider, response);
    return standardResponse.toolCalls;
  }

  /**
   * 提取 Token 使用统计（公共方法）
   * @param provider 提供商类型
   * @param response 原始响应对象
   * @returns Token 使用统计
   */
  static extractTokenUsage(provider: ProviderType, response: unknown): TokenUsage | undefined {
    const standardResponse = this.parse(provider, response);
    return standardResponse.tokenUsage;
  }
}
