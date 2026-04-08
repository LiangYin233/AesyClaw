import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  ILLMProvider,
  LLMProviderType,
  LLMMode,
  StandardResponse,
  ToolCall,
  LLMProviderConfig,
} from '../types.js';
import { logger } from '../../../platform/observability/logger.js';
import { PromptContext } from '../prompt-context.js';
import { TokenUsageMapper } from '../utils/token-usage-mapper.js';
import { FinishReasonMapper } from '../utils/finish-reason-mapper.js';
import { MessageTransformer } from '../transformers/message-transformer.js';
import { ToolTransformer } from '../transformers/tool-transformer.js';

export class OpenAIChatAdapter implements ILLMProvider {
  readonly providerType = LLMProviderType.OpenAIChat;
  readonly supportedModes: LLMMode[] = [LLMMode.Chat];

  private client: OpenAI;
  private model: string;
  private messageTransformer: MessageTransformer;
  private toolTransformer: ToolTransformer;

  constructor(config: LLMProviderConfig) {
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error('OpenAI API key is required. Please configure it in config.json.');
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout || 60000,
    });

    this.model = config.model || 'gpt-4o-mini';
    
    // 初始化转换器
    this.messageTransformer = new MessageTransformer();
    this.toolTransformer = new ToolTransformer();

    logger.info(
      { provider: this.providerType, model: this.model },
      '🤖 OpenAI Chat Adapter 已初始化'
    );
  }

  validateConfig(): boolean {
    return !!this.client.apiKey;
  }

  async generate(context: PromptContext): Promise<StandardResponse> {
    // 使用 MessageTransformer 转换消息
    const convertedMessages = this.messageTransformer.toOpenAI(
      context.messages,
      context.system.systemPrompt
    );

    // 构建消息数组：系统消息 + 对话消息
    const allMessages: ChatCompletionMessageParam[] = [];
    
    // 如果有系统消息，添加到开头
    if (convertedMessages.systemMessage) {
      allMessages.push(convertedMessages.systemMessage);
    }
    
    // 添加对话消息
    allMessages.push(...convertedMessages.messages);

    // 使用 ToolTransformer 转换工具
    const openAITools = this.toolTransformer.toOpenAI(context.tools);

    logger.debug(
      {
        messageCount: allMessages.length,
        hasTools: context.tools.length > 0,
        toolCount: context.tools.length,
        contextMetadata: context.metadata,
      },
      '📤 从 PromptContext 发送请求到 OpenAI Chat API'
    );

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: allMessages,
        tools: openAITools.length > 0 ? openAITools : undefined,
        tool_choice: openAITools.length > 0 ? 'auto' : undefined,
      });

      const choice = response.choices[0];
      const message = choice.message;

      const toolCalls: ToolCall[] = [];
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const tc of message.tool_calls) {
          if (tc.type === 'function' && 'function' in tc) {
            toolCalls.push({
              id: tc.id,
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments),
            });
          }
        }
      }

      const tokenUsage = TokenUsageMapper.fromOpenAI(response.usage);

      const finishReason = FinishReasonMapper.fromOpenAI(choice.finish_reason);

      logger.info(
        {
          finishReason,
          hasContent: !!message.content,
          toolCallCount: toolCalls.length,
          tokenUsage,
        },
        '从 PromptContext 收到 OpenAI 响应'
      );

      return {
        text: message.content || '',
        toolCalls,
        tokenUsage,
        finishReason,
        rawResponse: response,
      };
    } catch (error) {
      logger.error({ error }, '从 PromptContext 调用 OpenAI Chat API 失败');
      throw error;
    }
  }
}
