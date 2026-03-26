import type { LLMMessage, LLMResponse, ToolCall, ToolDefinition } from '../../../types.js';
import type {
  ProviderAdapter,
  ProviderCapabilityProfile,
  ProviderChatOptions,
  ProviderLogContext,
  ProviderRequest,
  ProviderRuntimeConfig
} from '../core/adapter.js';

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIMessage {
  role: string;
  content?: string | null | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
      detail?: 'auto' | 'low' | 'high';
    };
  }>;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIResponseChoice {
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason?: string | null;
}

interface OpenAIResponse {
  choices?: OpenAIResponseChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

export class OpenAIChatAdapter implements ProviderAdapter {
  readonly type = 'openai';
  readonly displayName = 'OpenAI Chat Completions';
  readonly defaultApiBase = 'https://api.openai.com/v1';

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
    _config: ProviderRuntimeConfig,
    _context: ProviderLogContext
  ): ProviderRequest {
    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(messages),
      tools: this.formatTools(tools)
    };

    if (options?.reasoning === true) {
      body.enable_thinking = true;
      body.thinking = { type: 'enabled' };
    }

    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    return {
      path: '/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_config.apiKey || ''}`
      },
      body
    };
  }

  parseResponse(data: unknown, _context: ProviderLogContext): LLMResponse {
    const response = isObject(data) ? data as OpenAIResponse : {};
    const choice = response.choices?.[0];
    const content = choice?.message?.content;
    const reasoningContent = choice?.message?.reasoning_content;
    const toolCalls = (choice?.message?.tool_calls || []).map((toolCall) => {
      let args: Record<string, unknown>;

      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: args
      };
    });

    return {
      content: content ?? undefined,
      reasoning_content: reasoningContent ?? undefined,
      toolCalls,
      finishReason: choice?.finish_reason || 'stop',
      usage: response.usage
        ? {
          prompt_tokens: response.usage.prompt_tokens ?? 0,
          completion_tokens: response.usage.completion_tokens ?? 0,
          total_tokens: response.usage.total_tokens ?? 0
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

  private formatTools(tools?: ToolDefinition[]): OpenAITool[] | undefined {
    if (!tools?.length) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  private formatMessages(messages: LLMMessage[]): OpenAIMessage[] {
    return messages.map((message) => {
      const formatted: OpenAIMessage = {
        role: message.role
      };

      if (message.role === 'tool') {
        formatted.tool_call_id = message.toolCallId;
        formatted.content = message.content;
        return formatted;
      }

      if (message.toolCalls?.length) {
        formatted.tool_calls = message.toolCalls.map((toolCall: ToolCall) => ({
          id: toolCall.id || '',
          type: 'function',
          function: {
            name: toolCall.name || '',
            arguments: this.stringifyArguments(toolCall.arguments)
          }
        }));
      }

      formatted.content = message.content;
      return formatted;
    });
  }

  private stringifyArguments(argumentsValue: ToolCall['arguments']): string {
    if (typeof argumentsValue === 'string') {
      return argumentsValue;
    }

    if (argumentsValue && Object.keys(argumentsValue).length > 0) {
      return JSON.stringify(argumentsValue);
    }

    return '{}';
  }
}
