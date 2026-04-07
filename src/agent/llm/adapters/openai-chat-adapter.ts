import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  ILLMProvider,
  LLMProviderType,
  LLMMode,
  StandardMessage,
  StandardResponse,
  ToolCall,
  TokenUsage,
  LLMProviderConfig,
  MessageRole,
} from '../types.js';
import { ToolDefinition } from '../../../platform/tools/types.js';
import { logger } from '../../../platform/observability/logger.js';
import { PromptContext } from '../prompt-context.js';

export class OpenAIChatAdapter implements ILLMProvider {
  readonly providerType = LLMProviderType.OpenAIChat;
  readonly supportedModes: LLMMode[] = [LLMMode.Chat];

  private client: OpenAI;
  private model: string;

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

    logger.info(
      { provider: this.providerType, model: this.model },
      '🤖 OpenAI Chat Adapter 已初始化'
    );
  }

  validateConfig(): boolean {
    return !!this.client.apiKey;
  }

  async generate(context: PromptContext): Promise<StandardResponse> {
    const systemMessage: ChatCompletionMessageParam = {
      role: 'system',
      content: context.system.systemPrompt,
    };

    const chatMessages = this.convertMessages(context.messages);

    const allMessages = [systemMessage, ...chatMessages];

    const openAITools = context.tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

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

      const tokenUsage: TokenUsage | undefined = response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined;

      const finishReason = this.mapFinishReason(choice.finish_reason);

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

  private convertMessages(messages: StandardMessage[]): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === MessageRole.System) {
        result.push({
          role: 'system',
          content: msg.content,
        });
      } else if (msg.role === MessageRole.User) {
        result.push({
          role: 'user',
          content: msg.content,
        });
      } else if (msg.role === MessageRole.Assistant) {
        const assistantMsg: ChatCompletionMessageParam = {
          role: 'assistant',
          content: msg.content || null,
        };

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          (assistantMsg as any).tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }

        result.push(assistantMsg);
      } else if (msg.role === MessageRole.Tool) {
        if (!msg.toolCallId) {
          logger.warn({ msgRole: msg.role }, 'Tool message missing toolCallId, skipping');
          continue;
        }
        result.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId,
        });
      }
    }

    return result;
  }

  private mapFinishReason(
    reason: string | null
  ): StandardResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_calls';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'error';
    }
  }
}
