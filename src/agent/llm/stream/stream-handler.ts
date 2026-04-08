import { logger } from '../../../platform/observability/logger.js';
import { TokenUsage, ToolCall } from '../types.js';
import { FinishReasonMapper } from '../utils/finish-reason-mapper.js';

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

/**
 * 流式处理器类
 * 用于处理 OpenAI 和 Anthropic 的流式响应
 */
export class StreamHandler implements AsyncGenerator<StreamOutput, void, unknown> {
  private provider: 'openai' | 'anthropic';
  private debug: boolean;

  // 累积的文本内容
  private accumulatedText: string = '';

  // 累积的工具调用
  private toolCallsMap: Map<number, ToolCall> = new Map();

  // 累积的 Token 统计
  private tokenUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  // 结束原因
  private finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error' | undefined;

  // 是否已完成
  private isCompleted: boolean = false;

  // Anthropic 特定状态
  private anthropicContentBlocks: Map<number, { type: string; id?: string; name?: string; text?: string; arguments?: string }> = new Map();

  constructor(options: StreamHandlerOptions) {
    this.provider = options.provider;
    this.debug = options.debug || false;

    logger.info({ provider: this.provider }, '🌊 StreamHandler 已初始化');
  }

  /**
   * 解析单个流式块
   * @param chunk 流式响应块
   * @returns 流式输出项
   */
  parseChunk(chunk: StreamChunk): StreamOutput | null {
    if (this.provider === 'openai') {
      return this.parseOpenAIChunk(chunk as OpenAIStreamChunk);
    } else {
      return this.parseAnthropicChunk(chunk as AnthropicStreamChunk);
    }
  }

  /**
   * 解析 OpenAI 流式块
   * @param chunk OpenAI 流式块
   * @returns 流式输出项
   */
  private parseOpenAIChunk(chunk: OpenAIStreamChunk): StreamOutput | null {
    const choice = chunk.choices[0];
    if (!choice) {
      return null;
    }

    const delta = choice.delta;
    const finishReason = choice.finish_reason;

    // 处理文本内容
    if (delta.content) {
      this.accumulatedText += delta.content;

      if (this.debug) {
        logger.debug({ text: delta.content }, '📝 OpenAI 流式文本块');
      }

      return {
        text: delta.content,
        done: false,
      };
    }

    // 处理工具调用
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index;

        // 获取或创建工具调用对象
        let toolCall = this.toolCallsMap.get(index);

        if (!toolCall && toolCallDelta.id) {
          // 新的工具调用
          toolCall = {
            id: toolCallDelta.id,
            name: toolCallDelta.function?.name || '',
            arguments: {},
          };
          this.toolCallsMap.set(index, toolCall);
        } else if (toolCall && toolCallDelta.function) {
          // 累积工具调用参数
          if (toolCallDelta.function.name) {
            toolCall.name = toolCallDelta.function.name;
          }
          if (toolCallDelta.function.arguments) {
            // 累积参数字符串，稍后解析
            const existingArgs = (toolCall.arguments as any).__raw__ || '';
            const newArgs = existingArgs + toolCallDelta.function.arguments;
            (toolCall.arguments as any).__raw__ = newArgs;
          }
        }

        if (this.debug && toolCall) {
          logger.debug({ toolCall }, '🔧 OpenAI 流式工具调用块');
        }
      }
    }

    // 处理结束原因
    if (finishReason) {
      this.finishReason = FinishReasonMapper.fromOpenAI(finishReason);
      this.isCompleted = true;

      // 解析所有工具调用的参数
      this.parseToolCallArguments();

      // 处理 Token 使用统计
      if (chunk.usage) {
        this.tokenUsage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }

      logger.info(
        {
          finishReason: this.finishReason,
          textLength: this.accumulatedText.length,
          toolCallCount: this.toolCallsMap.size,
          tokenUsage: this.tokenUsage,
        },
        '✅ OpenAI 流式响应完成'
      );

      return {
        done: true,
        text: this.accumulatedText,
        tokenUsage: this.tokenUsage,
        finishReason: this.finishReason,
      };
    }

    return null;
  }

  /**
   * 解析 Anthropic 流式块
   * @param chunk Anthropic 流式块
   * @returns 流式输出项
   */
  private parseAnthropicChunk(chunk: AnthropicStreamChunk): StreamOutput | null {
    const type = chunk.type;

    switch (type) {
      case 'message_start': {
        // 消息开始，初始化 Token 统计
        if (chunk.message?.usage) {
          this.tokenUsage.promptTokens = chunk.message.usage.input_tokens;
          this.tokenUsage.completionTokens = chunk.message.usage.output_tokens;
          this.tokenUsage.totalTokens = this.tokenUsage.promptTokens + this.tokenUsage.completionTokens;
        }

        if (this.debug) {
          logger.debug({ usage: chunk.message?.usage }, '🚀 Anthropic 消息开始');
        }
        return null;
      }

      case 'content_block_start': {
        // 内容块开始
        if (chunk.index !== undefined && chunk.content_block) {
          const block = chunk.content_block;
          this.anthropicContentBlocks.set(chunk.index, {
            type: block.type,
            id: block.id,
            name: block.name,
            text: block.text || '',
            arguments: '',
          });

          if (this.debug) {
            logger.debug({ index: chunk.index, block }, '📦 Anthropic 内容块开始');
          }
        }
        return null;
      }

      case 'content_block_delta': {
        // 内容块增量
        if (chunk.index !== undefined && chunk.delta) {
          const block = this.anthropicContentBlocks.get(chunk.index);
          const delta = chunk.delta;

          if (block) {
            if (delta.type === 'text_delta' && delta.text) {
              // 文本增量
              block.text = (block.text || '') + delta.text;
              this.accumulatedText += delta.text;

              if (this.debug) {
                logger.debug({ text: delta.text }, '📝 Anthropic 流式文本块');
              }

              return {
                text: delta.text,
                done: false,
              };
            } else if (delta.type === 'input_json_delta' && delta.partial_json) {
              // 工具调用参数增量
              block.arguments = (block.arguments || '') + delta.partial_json;

              if (this.debug) {
                logger.debug({ arguments: delta.partial_json }, '🔧 Anthropic 工具调用参数块');
              }
            }
          }
        }
        return null;
      }

      case 'content_block_stop': {
        // 内容块结束
        if (chunk.index !== undefined) {
          const block = this.anthropicContentBlocks.get(chunk.index);

          if (block && block.type === 'tool_use') {
            // 完成工具调用
            try {
              const args = block.arguments ? JSON.parse(block.arguments) : {};
              const toolCall: ToolCall = {
                id: block.id || '',
                name: block.name || '',
                arguments: args,
              };

              // 添加到工具调用映射
              const toolCallIndex = this.toolCallsMap.size;
              this.toolCallsMap.set(toolCallIndex, toolCall);

              if (this.debug) {
                logger.debug({ toolCall }, '✅ Anthropic 工具调用完成');
              }

              return {
                toolCall,
                done: false,
              };
            } catch (error) {
              logger.error({ error, block }, '解析 Anthropic 工具调用参数失败');
            }
          }
        }
        return null;
      }

      case 'message_delta': {
        // 消息增量，更新 Token 统计
        if (chunk.usage) {
          this.tokenUsage.completionTokens += chunk.usage.output_tokens;
          this.tokenUsage.totalTokens = this.tokenUsage.promptTokens + this.tokenUsage.completionTokens;
        }

        if (chunk.delta?.type) {
          // 注意：Anthropic 的 stop_reason 在 message_delta 中，但类型定义可能不完整
          // 我们需要在 message_stop 时处理结束
        }

        if (this.debug) {
          logger.debug({ usage: chunk.usage }, '📊 Anthropic 消息增量');
        }
        return null;
      }

      case 'message_stop': {
        // 消息结束
        this.isCompleted = true;

        // 确定结束原因
        if (this.toolCallsMap.size > 0) {
          this.finishReason = 'tool_calls';
        } else {
          this.finishReason = 'stop';
        }

        logger.info(
          {
            finishReason: this.finishReason,
            textLength: this.accumulatedText.length,
            toolCallCount: this.toolCallsMap.size,
            tokenUsage: this.tokenUsage,
          },
          '✅ Anthropic 流式响应完成'
        );

        return {
          done: true,
          text: this.accumulatedText,
          tokenUsage: this.tokenUsage,
          finishReason: this.finishReason,
        };
      }

      default:
        return null;
    }
  }

  /**
   * 解析工具调用参数
   * 将累积的参数字符串解析为 JSON 对象
   */
  private parseToolCallArguments(): void {
    for (const [index, toolCall] of this.toolCallsMap) {
      const rawArgs = (toolCall.arguments as any).__raw__;
      if (rawArgs) {
        try {
          toolCall.arguments = JSON.parse(rawArgs);
        } catch (error) {
          logger.error({ error, rawArgs, toolCallId: toolCall.id }, '解析工具调用参数失败');
          toolCall.arguments = {};
        }
      }
    }
  }

  /**
   * 获取累积的 Token 统计
   * @returns Token 使用统计
   */
  getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage };
  }

  /**
   * 判断流式响应是否完成
   * @returns 是否完成
   */
  isComplete(): boolean {
    return this.isCompleted;
  }

  /**
   * 获取累积的文本内容
   * @returns 文本内容
   */
  getAccumulatedText(): string {
    return this.accumulatedText;
  }

  /**
   * 获取所有工具调用
   * @returns 工具调用数组
   */
  getToolCalls(): ToolCall[] {
    return Array.from(this.toolCallsMap.values());
  }

  /**
   * 获取结束原因
   * @returns 结束原因
   */
  getFinishReason(): 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error' | undefined {
    return this.finishReason;
  }

  // AsyncGenerator 接口实现

  /**
   * 下一个值
   * 注意：这个实现需要外部传入流式块
   * 实际使用时应该通过 parseChunk 方法处理流式块
   */
  async next(): Promise<IteratorResult<StreamOutput, void>> {
    // 这个方法是为了实现 AsyncGenerator 接口
    // 实际的流式处理应该通过 parseChunk 方法完成
    if (this.isCompleted) {
      return { done: true, value: undefined };
    }

    // 返回一个等待状态的输出
    return {
      done: false,
      value: { done: false },
    };
  }

  /**
   * 返回值
   */
  async return(value?: unknown): Promise<IteratorResult<StreamOutput, void>> {
    this.isCompleted = true;
    return { done: true, value: undefined };
  }

  /**
   * 抛出错误
   */
  async throw(e?: unknown): Promise<IteratorResult<StreamOutput, void>> {
    this.isCompleted = true;
    throw e;
  }

  /**
   * 获取迭代器
   */
  [Symbol.asyncIterator](): AsyncGenerator<StreamOutput, void, unknown> {
    return this;
  }

  /**
   * 异步资源释放
   * 实现 AsyncDisposable 接口
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.isCompleted = true;
    // 清理资源
    this.toolCallsMap.clear();
    this.anthropicContentBlocks.clear();
  }
}

/**
 * 创建 OpenAI 流式处理器
 * @param options 配置选项
 * @returns StreamHandler 实例
 */
export function createOpenAIStreamHandler(options?: { debug?: boolean }): StreamHandler {
  return new StreamHandler({ provider: 'openai', ...options });
}

/**
 * 创建 Anthropic 流式处理器
 * @param options 配置选项
 * @returns StreamHandler 实例
 */
export function createAnthropicStreamHandler(options?: { debug?: boolean }): StreamHandler {
  return new StreamHandler({ provider: 'anthropic', ...options });
}

/**
 * 处理 OpenAI 流式响应的辅助函数
 * @param stream OpenAI 流式响应
 * @param onToken 每个 token 的回调函数
 * @param onToolCall 工具调用的回调函数
 * @param onComplete 完成的回调函数
 * @returns StreamHandler 实例
 */
export async function handleOpenAIStream(
  stream: AsyncIterable<OpenAIStreamChunk>,
  onToken?: (text: string) => void,
  onToolCall?: (toolCall: ToolCall) => void,
  onComplete?: (result: { text: string; toolCalls: ToolCall[]; tokenUsage: TokenUsage; finishReason: string }) => void
): Promise<StreamHandler> {
  const handler = new StreamHandler({ provider: 'openai' });

  for await (const chunk of stream) {
    const output = handler.parseChunk(chunk);

    if (output) {
      if (output.text && onToken) {
        onToken(output.text);
      }

      if (output.toolCall && onToolCall) {
        onToolCall(output.toolCall);
      }

      if (output.done && onComplete) {
        onComplete({
          text: handler.getAccumulatedText(),
          toolCalls: handler.getToolCalls(),
          tokenUsage: handler.getTokenUsage(),
          finishReason: handler.getFinishReason() || 'stop',
        });
      }
    }
  }

  return handler;
}

/**
 * 处理 Anthropic 流式响应的辅助函数
 * @param stream Anthropic 流式响应
 * @param onToken 每个 token 的回调函数
 * @param onToolCall 工具调用的回调函数
 * @param onComplete 完成的回调函数
 * @returns StreamHandler 实例
 */
export async function handleAnthropicStream(
  stream: AsyncIterable<AnthropicStreamChunk>,
  onToken?: (text: string) => void,
  onToolCall?: (toolCall: ToolCall) => void,
  onComplete?: (result: { text: string; toolCalls: ToolCall[]; tokenUsage: TokenUsage; finishReason: string }) => void
): Promise<StreamHandler> {
  const handler = new StreamHandler({ provider: 'anthropic' });

  for await (const chunk of stream) {
    const output = handler.parseChunk(chunk);

    if (output) {
      if (output.text && onToken) {
        onToken(output.text);
      }

      if (output.toolCall && onToolCall) {
        onToolCall(output.toolCall);
      }

      if (output.done && onComplete) {
        onComplete({
          text: handler.getAccumulatedText(),
          toolCalls: handler.getToolCalls(),
          tokenUsage: handler.getTokenUsage(),
          finishReason: handler.getFinishReason() || 'stop',
        });
      }
    }
  }

  return handler;
}
