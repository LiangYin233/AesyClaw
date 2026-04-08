/**
 * 消息转换器模块
 * 用于统一处理不同 LLM 提供商的消息格式转换
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  StandardMessage,
  MessageRole,
  ToolCall,
  LLMProviderType,
} from '../types.js';
import { logger } from '../../../platform/observability/logger.js';

/**
 * OpenAI 助手消息类型（包含工具调用）
 */
interface AssistantMessageWithToolCalls {
  role: 'assistant';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * Anthropic 内容块类型
 */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

/**
 * Anthropic 消息类型
 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/**
 * OpenAI 格式的系统消息
 */
interface OpenAISystemMessage {
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
  messages: ChatCompletionMessageParam[];
}

/**
 * 转换后的 Anthropic 消息结果
 */
export interface AnthropicConvertedMessages {
  /** 系统提示（单独传递） */
  systemPrompt?: string;
  /** 对话消息数组 */
  messages: AnthropicMessage[];
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

/**
 * OpenAI 消息格式化器
 * 将 StandardMessage 转换为 OpenAI API 规范的消息格式
 *
 * 特点：
 * - 系统消息放在 messages 数组第一个位置
 * - 工具结果使用 role: 'tool'，需要 tool_call_id
 * - 助手消息的工具调用使用 tool_calls 数组
 */
export class OpenAIMessageFormatter implements IMessageFormatter {
  /**
   * 格式化消息为 OpenAI 格式
   * @param messages 标准消息数组
   * @param systemPrompt 系统提示（可选）
   * @returns OpenAI 格式的消息结果
   */
  format(messages: StandardMessage[], systemPrompt?: string): OpenAIConvertedMessages {
    const result: ChatCompletionMessageParam[] = [];

    // 处理系统提示
    let systemMessage: OpenAISystemMessage | undefined;
    if (systemPrompt) {
      systemMessage = {
        role: 'system',
        content: systemPrompt,
      };
    }

    // 转换消息
    for (const msg of messages) {
      const converted = this.convertMessage(msg);
      if (converted) {
        result.push(converted);
      }
    }

    logger.debug(
      {
        inputCount: messages.length,
        outputCount: result.length,
        hasSystemMessage: !!systemMessage,
      },
      'OpenAI 消息格式转换完成'
    );

    return {
      systemMessage,
      messages: result,
    };
  }

  /**
   * 转换单个消息
   * @param msg 标准消息
   * @returns OpenAI 消息格式或 null（如果消息应被跳过）
   */
  private convertMessage(msg: StandardMessage): ChatCompletionMessageParam | null {
    switch (msg.role) {
      case MessageRole.System:
        return this.convertSystemMessage(msg);

      case MessageRole.User:
        return this.convertUserMessage(msg);

      case MessageRole.Assistant:
        return this.convertAssistantMessage(msg);

      case MessageRole.Tool:
        return this.convertToolMessage(msg);

      default:
        logger.warn({ role: msg.role }, '未知的消息角色，跳过转换');
        return null;
    }
  }

  /**
   * 转换系统消息
   */
  private convertSystemMessage(msg: StandardMessage): ChatCompletionMessageParam {
    return {
      role: 'system',
      content: msg.content,
    };
  }

  /**
   * 转换用户消息
   */
  private convertUserMessage(msg: StandardMessage): ChatCompletionMessageParam {
    return {
      role: 'user',
      content: msg.content,
    };
  }

  /**
   * 转换助手消息
   * 支持包含工具调用的情况
   */
  private convertAssistantMessage(msg: StandardMessage): ChatCompletionMessageParam {
    // 构建助手消息
    const assistantMsg: ChatCompletionMessageParam = {
      role: 'assistant',
      content: msg.content || null,
    };

    // 如果有工具调用，添加 tool_calls 字段
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // 使用类型断言确保类型正确
      (assistantMsg as AssistantMessageWithToolCalls).tool_calls = msg.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    return assistantMsg;
  }

  /**
   * 转换工具消息（工具执行结果）
   */
  private convertToolMessage(msg: StandardMessage): ChatCompletionMessageParam | null {
    if (!msg.toolCallId) {
      logger.warn({ msgRole: msg.role }, 'Tool message 缺少 toolCallId，跳过');
      return null;
    }

    return {
      role: 'tool',
      content: msg.content,
      tool_call_id: msg.toolCallId,
    };
  }
}

/**
 * Anthropic 消息格式化器
 * 将 StandardMessage 转换为 Anthropic API 规范的消息格式
 *
 * 特点：
 * - 系统消息单独传递（不在 messages 数组中）
 * - 工具结果作为 user 消息的 content block (type: 'tool_result')
 * - 助手消息的工具调用作为 content block (type: 'tool_use')
 * - 需要合并连续的 user 消息和 tool 消息
 */
export class AnthropicMessageFormatter implements IMessageFormatter {
  /**
   * 格式化消息为 Anthropic 格式
   * @param messages 标准消息数组
   * @param systemPrompt 系统提示（可选）
   * @returns Anthropic 格式的消息结果
   */
  format(messages: StandardMessage[], systemPrompt?: string): AnthropicConvertedMessages {
    const result: AnthropicMessage[] = [];
    let currentUserContent: AnthropicContentBlock[] = [];

    // 转换消息
    for (const msg of messages) {
      // Anthropic 不在 messages 数组中处理系统消息
      if (msg.role === MessageRole.System) {
        continue;
      }

      // 特殊处理助手消息：如果有累积的用户内容，先添加用户消息
      if (msg.role === MessageRole.Assistant && currentUserContent.length > 0) {
        result.push({ role: 'user', content: currentUserContent });
        currentUserContent = [];
      }

      const converted = this.convertMessage(msg, currentUserContent);

      // 如果返回了新的消息，添加到结果中
      if (converted) {
        result.push(converted.message);
        currentUserContent = converted.newCurrentContent;
      }
    }

    // 处理剩余的用户内容
    if (currentUserContent.length > 0) {
      result.push({ role: 'user', content: currentUserContent });
    }

    logger.debug(
      {
        inputCount: messages.length,
        outputCount: result.length,
        hasSystemPrompt: !!systemPrompt,
      },
      'Anthropic 消息格式转换完成'
    );

    return {
      systemPrompt,
      messages: result,
    };
  }

  /**
   * 转换单个消息
   * @param msg 标准消息
   * @param currentUserContent 当前用户内容块数组（用于合并）
   * @returns 转换结果或 null
   */
  private convertMessage(
    msg: StandardMessage,
    currentUserContent: AnthropicContentBlock[]
  ): { message: AnthropicMessage; newCurrentContent: AnthropicContentBlock[] } | null {
    switch (msg.role) {
      case MessageRole.User:
        return this.convertUserMessage(msg, currentUserContent);

      case MessageRole.Assistant:
        return this.convertAssistantMessage(msg, currentUserContent);

      case MessageRole.Tool:
        return this.convertToolMessage(msg, currentUserContent);

      default:
        return null;
    }
  }

  /**
   * 转换用户消息
   * 将用户消息添加到当前内容块中
   */
  private convertUserMessage(
    msg: StandardMessage,
    currentUserContent: AnthropicContentBlock[]
  ): { message: AnthropicMessage; newCurrentContent: AnthropicContentBlock[] } | null {
    // 添加用户文本到当前内容块
    currentUserContent.push({
      type: 'text',
      text: msg.content,
    });

    // 用户消息不立即返回，等待可能的后续 tool 消息
    return null;
  }

  /**
   * 转换助手消息
   * 构建助手消息内容（文本和工具调用）
   */
  private convertAssistantMessage(
    msg: StandardMessage,
    currentUserContent: AnthropicContentBlock[]
  ): { message: AnthropicMessage; newCurrentContent: AnthropicContentBlock[] } {
    // 构建助手消息内容
    const assistantContent: AnthropicContentBlock[] = [];

    // 添加文本内容
    if (msg.content) {
      assistantContent.push({ type: 'text', text: msg.content });
    }

    // 添加工具调用
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
    }

    // 返回助手消息，并清空当前用户内容
    return {
      message: { role: 'assistant', content: assistantContent },
      newCurrentContent: [],
    };
  }

  /**
   * 转换工具消息（工具执行结果）
   * 将工具结果添加到当前用户内容块中
   */
  private convertToolMessage(
    msg: StandardMessage,
    currentUserContent: AnthropicContentBlock[]
  ): { message: AnthropicMessage; newCurrentContent: AnthropicContentBlock[] } | null {
    // 添加工具结果到当前内容块
    currentUserContent.push({
      type: 'tool_result',
      tool_use_id: msg.toolCallId || '',
      content: msg.content,
    });

    // 工具消息不立即返回，等待可能的后续消息
    return null;
  }
}

/**
 * 消息转换器
 * 统一管理不同提供商的消息格式转换
 */
export class MessageTransformer {
  private formatters: Map<LLMProviderType, IMessageFormatter>;

  constructor() {
    this.formatters = new Map();

    // 注册默认的格式化器
    this.registerFormatter(LLMProviderType.OpenAIChat, new OpenAIMessageFormatter());
    this.registerFormatter(LLMProviderType.Anthropic, new AnthropicMessageFormatter());
  }

  /**
   * 注册消息格式化器
   * @param providerType 提供商类型
   * @param formatter 格式化器实例
   */
  registerFormatter(providerType: LLMProviderType, formatter: IMessageFormatter): void {
    this.formatters.set(providerType, formatter);
    logger.debug(
      { providerType },
      '已注册消息格式化器'
    );
  }

  /**
   * 转换消息为指定提供商的格式
   * @param providerType 提供商类型
   * @param messages 标准消息数组
   * @param systemPrompt 系统提示（可选）
   * @returns 转换后的消息格式
   */
  transform(
    providerType: LLMProviderType,
    messages: StandardMessage[],
    systemPrompt?: string
  ): OpenAIConvertedMessages | AnthropicConvertedMessages | unknown {
    const formatter = this.formatters.get(providerType);

    if (!formatter) {
      logger.warn(
        { providerType },
        '未找到对应的消息格式化器，返回原始消息'
      );
      return messages;
    }

    return formatter.format(messages, systemPrompt);
  }

  /**
   * 转换为 OpenAI 格式
   * @param messages 标准消息数组
   * @param systemPrompt 系统提示（可选）
   * @returns OpenAI 格式的消息
   */
  toOpenAI(
    messages: StandardMessage[],
    systemPrompt?: string
  ): OpenAIConvertedMessages {
    const formatter = new OpenAIMessageFormatter();
    return formatter.format(messages, systemPrompt) as OpenAIConvertedMessages;
  }

  /**
   * 转换为 Anthropic 格式
   * @param messages 标准消息数组
   * @param systemPrompt 系统提示（可选）
   * @returns Anthropic 格式的消息
   */
  toAnthropic(
    messages: StandardMessage[],
    systemPrompt?: string
  ): AnthropicConvertedMessages {
    const formatter = new AnthropicMessageFormatter();
    return formatter.format(messages, systemPrompt) as AnthropicConvertedMessages;
  }

  /**
   * 验证消息格式是否正确
   * @param messages 标准消息数组
   * @returns 验证结果
   */
  validate(messages: StandardMessage[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // 检查必需字段
      if (!msg.role) {
        errors.push(`消息 ${i}: 缺少 role 字段`);
      }

      if (!msg.content && msg.role !== MessageRole.Assistant) {
        errors.push(`消息 ${i}: 缺少 content 字段`);
      }

      // 检查工具消息的 toolCallId
      if (msg.role === MessageRole.Tool && !msg.toolCallId) {
        errors.push(`消息 ${i}: Tool 消息缺少 toolCallId`);
      }

      // 检查助手消息的工具调用
      if (msg.role === MessageRole.Assistant && msg.toolCalls) {
        for (let j = 0; j < msg.toolCalls.length; j++) {
          const tc = msg.toolCalls[j];
          if (!tc.id) {
            errors.push(`消息 ${i}, 工具调用 ${j}: 缺少 id`);
          }
          if (!tc.name) {
            errors.push(`消息 ${i}, 工具调用 ${j}: 缺少 name`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * 创建全局消息转换器实例
 */
export const messageTransformer = new MessageTransformer();
