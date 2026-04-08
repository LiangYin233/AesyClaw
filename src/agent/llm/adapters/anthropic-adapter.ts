import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
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
import { TokenUsageMapper } from '../utils/token-usage-mapper.js';
import { FinishReasonMapper } from '../utils/finish-reason-mapper.js';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export class AnthropicAdapter implements ILLMProvider {
  readonly providerType = LLMProviderType.Anthropic;
  readonly supportedModes: LLMMode[] = [LLMMode.Chat];

  private client: Anthropic;
  private model: string;

  constructor(config: LLMProviderConfig) {
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error('Anthropic API key is required. Please configure it in config.json.');
    }

    this.client = new Anthropic({
      apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout || 60000,
    });

    this.model = config.model || 'claude-sonnet-4-20250514';

    logger.info(
      { provider: this.providerType, model: this.model },
      '🤖 Anthropic Claude Adapter 已初始化'
    );
  }

  validateConfig(): boolean {
    return !!this.client.apiKey;
  }

  async generate(context: PromptContext): Promise<StandardResponse> {
    const anthropicMessages = this.convertMessages(context.messages);

    const anthropicTools = context.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));

    logger.debug(
      {
        messageCount: anthropicMessages.length,
        hasTools: context.tools.length > 0,
        toolCount: context.tools.length,
        contextMetadata: context.metadata,
      },
      '📤 从 PromptContext 发送请求到 Anthropic Claude API'
    );

    try {
      const response = await this.client.messages.create({
        model: this.model,
        system: context.system.systemPrompt,
        messages: anthropicMessages as any,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        max_tokens: context.metadata?.maxTokens || 8192,
      });

      const toolCalls: ToolCall[] = [];
      const contentBlocks = response.content;
      let text = '';

      for (const block of contentBlocks) {
        if (block.type === 'text') {
          text += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      const tokenUsage = TokenUsageMapper.fromAnthropic(response.usage);

      const finishReason = FinishReasonMapper.fromAnthropic(response.stop_reason);

      logger.info(
        {
          finishReason,
          hasContent: !!text,
          toolCallCount: toolCalls.length,
          tokenUsage,
        },
        '从 PromptContext 收到 Anthropic Claude 响应'
      );

      return {
        text: text.trim(),
        toolCalls,
        tokenUsage,
        finishReason,
        rawResponse: response,
      };
    } catch (error) {
      logger.error({ error }, '从 PromptContext 调用 Anthropic Claude API 失败');
      throw error;
    }
  }

  private convertMessages(messages: StandardMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];
    let currentUserContent: AnthropicContentBlock[] = [];

    for (const msg of messages) {
      if (msg.role === MessageRole.System) {
        continue;
      } else if (msg.role === MessageRole.User) {
        currentUserContent.push({
          type: 'text',
          text: msg.content,
        });
      } else if (msg.role === MessageRole.Assistant) {
        if (currentUserContent.length > 0) {
          result.push({ role: 'user', content: currentUserContent });
          currentUserContent = [];
        }

        const assistantContent: AnthropicContentBlock[] = [];
        if (msg.content) {
          assistantContent.push({ type: 'text', text: msg.content });
        }
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

        if (assistantContent.length > 0) {
          result.push({ role: 'assistant', content: assistantContent });
        }
      } else if (msg.role === MessageRole.Tool) {
        currentUserContent.push({
          type: 'tool_result',
          tool_use_id: msg.toolCallId!,
          content: msg.content,
        });
      }
    }

    if (currentUserContent.length > 0) {
      result.push({ role: 'user', content: currentUserContent });
    }

    return result;
  }
}
