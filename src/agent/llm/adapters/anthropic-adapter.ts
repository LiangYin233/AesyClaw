import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicAdapter implements ILLMProvider {
  readonly providerType = LLMProviderType.Anthropic;
  readonly supportedModes: LLMMode[] = [LLMMode.Chat];

  private client: Anthropic;
  private model: string;
  private messageTransformer: MessageTransformer;
  private toolTransformer: ToolTransformer;

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
    
    // 初始化转换器
    this.messageTransformer = new MessageTransformer();
    this.toolTransformer = new ToolTransformer();

    logger.info(
      { provider: this.providerType, model: this.model },
      '🤖 Anthropic Claude Adapter 已初始化'
    );
  }

  validateConfig(): boolean {
    return !!this.client.apiKey;
  }

  async generate(context: PromptContext): Promise<StandardResponse> {
    // 使用 MessageTransformer 转换消息
    const convertedMessages = this.messageTransformer.toAnthropic(
      context.messages,
      context.system.systemPrompt
    );

    // 使用 ToolTransformer 转换工具
    const anthropicTools = this.toolTransformer.toAnthropic(context.tools);

    logger.debug(
      {
        messageCount: convertedMessages.messages.length,
        hasTools: context.tools.length > 0,
        toolCount: context.tools.length,
        contextMetadata: context.metadata,
      },
      '📤 从 PromptContext 发送请求到 Anthropic Claude API'
    );

    try {
      const response = await this.client.messages.create({
        model: this.model,
        system: convertedMessages.systemPrompt || context.system.systemPrompt,
        messages: convertedMessages.messages,
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
}
