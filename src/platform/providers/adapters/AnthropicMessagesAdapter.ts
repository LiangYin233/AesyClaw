import { preview } from '../../observability/index.js';
import type { LLMMessage, LLMResponse, ToolCall, ToolDefinition } from '../../../types.js';
import type {
  ProviderAdapter,
  ProviderCapabilityProfile,
  ProviderChatOptions,
  ProviderLogContext,
  ProviderRequest,
  ProviderRuntimeConfig
} from '../core/adapter.js';

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicUrlImageSource {
  type: 'url';
  url: string;
}

interface AnthropicBase64ImageSource {
  type: 'base64';
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
}

interface AnthropicImageBlock {
  type: 'image';
  source: AnthropicUrlImageSource | AnthropicBase64ImageSource;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

type AnthropicUserContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolResultBlock;

type AnthropicAssistantContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock;

interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: AnthropicUserContentBlock[] | AnthropicAssistantContentBlock[];
}

interface AnthropicThinkingConfig {
  type: 'enabled';
  budget_tokens: number;
}

interface AnthropicResponse {
  content?: AnthropicResponseContentBlock[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

type AnthropicResponseContentBlock =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; id?: string; name?: string; input?: unknown }
  | { type?: string; [key: string]: unknown };

const ANTHROPIC_VERSION = '2023-06-01';
const SUPPORTED_BASE64_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

export class AnthropicMessagesAdapter implements ProviderAdapter {
  readonly type = 'anthropic';
  readonly displayName = 'Anthropic';
  readonly defaultApiBase = 'https://api.anthropic.com/v1';

  capabilities(): ProviderCapabilityProfile {
    return {
      supportsTools: true,
      supportsVisionInput: true,
      supportsReasoning: true,
      supportsStatefulConversation: false
    };
  }

  buildRequest(
    messages: LLMMessage[],
    tools: ToolDefinition[] | undefined,
    model: string,
    options: ProviderChatOptions | undefined,
    config: ProviderRuntimeConfig,
    context: ProviderLogContext
  ): ProviderRequest {
    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(messages, context)
    };

    const system = this.collectSystemPrompt(messages);
    if (system) {
      body.system = system;
    }

    const formattedTools = this.formatTools(tools);
    if (formattedTools) {
      body.tools = formattedTools;
    }

    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const thinking = this.buildThinkingConfig(options, config);
    if (thinking) {
      body.thinking = thinking;
    }

    if (options?.maxTokens === undefined && config.extraBody?.max_tokens === undefined) {
      context.warn('Anthropic provider 未配置 max_tokens，API 可能会返回错误', {
        model
      });
    }

    return {
      path: '/messages',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': `${config.apiKey || ''}`
      },
      body
    };
  }

  parseResponse(data: unknown, context: ProviderLogContext): LLMResponse {
    const response = isObject(data) ? data as AnthropicResponse : {};
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;

    return {
      content: this.extractContent(response),
      reasoning_content: undefined,
      toolCalls: this.extractToolCalls(response, context),
      finishReason: this.mapFinishReason(response),
      usage: response.usage
        ? {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens
        }
        : undefined
    };
  }

  extractErrorMessage(data: unknown): string | undefined {
    if (!isObject(data) || !isObject(data.error)) {
      return undefined;
    }

    return typeof data.error.message === 'string' ? data.error.message : undefined;
  }

  private collectSystemPrompt(messages: LLMMessage[]): string | undefined {
    const parts: string[] = [];
    for (const message of messages) {
      if (message.role !== 'system' || typeof message.content !== 'string') {
        continue;
      }

      const content = message.content.trim();
      if (content) {
        parts.push(content);
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  private formatTools(tools?: ToolDefinition[]): AnthropicTool[] | undefined {
    if (!tools?.length) {
      return undefined;
    }

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }

  private formatMessages(messages: LLMMessage[], context: ProviderLogContext): AnthropicMessageParam[] {
    return messages.flatMap((message) => this.formatMessage(message, context));
  }

  private formatMessage(message: LLMMessage, context: ProviderLogContext): AnthropicMessageParam[] {
    if (message.role === 'system') {
      return [];
    }

    if (message.role === 'tool') {
      return [{
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.toolCallId || '',
          content: this.stringifyContent(message.content)
        }]
      }];
    }

    if (message.role === 'user') {
      return [{
        role: 'user',
        content: this.formatUserContent(message.content, context)
      }];
    }

    const content = this.formatAssistantContent(message, context);
    return content.length > 0
      ? [{ role: 'assistant', content }]
      : [];
  }

  private formatUserContent(content: LLMMessage['content'], context: ProviderLogContext): AnthropicUserContentBlock[] {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }];
    }

    const blocks: AnthropicUserContentBlock[] = [];
    for (const item of content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        blocks.push({ type: 'text', text: item.text });
        continue;
      }

      if (item.type === 'image_url' && item.image_url?.url) {
        const imageBlock = this.formatImageBlock(item.image_url.url, context);
        if (imageBlock) {
          blocks.push(imageBlock);
        }
      }
    }

    return blocks;
  }

  private formatAssistantContent(message: LLMMessage, context: ProviderLogContext): AnthropicAssistantContentBlock[] {
    const blocks: AnthropicAssistantContentBlock[] = [];

    if (typeof message.content === 'string') {
      if (message.content.length > 0) {
        blocks.push({ type: 'text', text: message.content });
      }
    } else {
      for (const item of message.content) {
        if (item.type === 'text' && typeof item.text === 'string') {
          blocks.push({ type: 'text', text: item.text });
        }
      }
    }

    for (const toolCall of message.toolCalls || []) {
      blocks.push({
        type: 'tool_use',
        id: toolCall.id || '',
        name: toolCall.name || '',
        input: this.normalizeToolInput(toolCall.arguments, toolCall.name || '', context)
      });
    }

    return blocks;
  }

  private formatImageBlock(url: string, context: ProviderLogContext): AnthropicImageBlock | null {
    const dataUrlMatch = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      const mediaType = dataUrlMatch[1];
      const data = dataUrlMatch[2];
      if (!SUPPORTED_BASE64_IMAGE_TYPES.has(mediaType)) {
        context.warn('Anthropic 图片 media type 不受支持，已跳过', {
          mediaType
        });
        return null;
      }

      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType as AnthropicBase64ImageSource['media_type'],
          data
        }
      };
    }

    return {
      type: 'image',
      source: {
        type: 'url',
        url
      }
    };
  }

  private normalizeToolInput(
    input: ToolCall['arguments'] | unknown,
    toolName: string,
    context: ProviderLogContext
  ): Record<string, unknown> {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }

    context.warn('工具调用参数格式无效，已回退为空对象', {
      toolName,
      inputPreview: preview(typeof input === 'string' ? input : JSON.stringify(input))
    });
    return {};
  }

  private stringifyContent(content: LLMMessage['content']): string {
    if (typeof content === 'string') {
      return content;
    }

    return content.flatMap((item) => {
      if (item.type === 'text' && typeof item.text === 'string') {
        return [item.text];
      }

      if (item.type === 'image_url' && item.image_url?.url) {
        return [item.image_url.url];
      }

      return [];
    }).join('\n');
  }

  private extractContent(response: AnthropicResponse): string {
    const parts: string[] = [];
    for (const block of response.content || []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }

    return parts.join('\n');
  }

  private extractToolCalls(response: AnthropicResponse, context: ProviderLogContext): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    for (const block of response.content || []) {
      if (!this.isToolUseBlock(block)) {
        continue;
      }

      let input: Record<string, unknown>;
      if (block.input && typeof block.input === 'object' && !Array.isArray(block.input)) {
        input = block.input as Record<string, unknown>;
      } else {
        context.warn('Anthropic tool_use.input 格式无效，已回退为空对象', {
          toolName: block.name,
          inputPreview: preview(JSON.stringify(block.input))
        });
        input = {};
      }

      toolCalls.push({
        id: block.id || '',
        name: block.name || '',
        arguments: input
      });
    }

    return toolCalls;
  }

  private mapFinishReason(response: AnthropicResponse): string {
    if (response.stop_reason === 'end_turn') {
      return 'stop';
    }

    return response.stop_reason || 'stop';
  }

  private buildThinkingConfig(
    options: ProviderChatOptions | undefined,
    config: ProviderRuntimeConfig
  ): AnthropicThinkingConfig | undefined {
    if (config.extraBody?.thinking !== undefined || options?.reasoning !== true) {
      return undefined;
    }

    return {
      type: 'enabled',
      budget_tokens: 1024
    };
  }

  private isToolUseBlock(
    block: AnthropicResponseContentBlock
  ): block is { type: 'tool_use'; id?: string; name?: string; input?: unknown } {
    return block.type === 'tool_use';
  }
}
