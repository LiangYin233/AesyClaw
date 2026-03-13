import { LLMProvider } from './base.js';
import type { LLMMessage, LLMResponse, ToolDefinition, ToolCall } from '../types.js';
import { normalizeError, isRetryableError } from '../errors/index.js';
import { logger, preview } from '../observability/index.js';

interface OpenAITool {
  type: string;
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
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIResponse {
  choices?: Array<{
    message: {
      content: string | null;
      reasoning_content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    message: string;
  };
}

export class OpenAIProvider extends LLMProvider {
  private baseURL = 'https://api.openai.com/v1';
  private log = logger.child('Provider');

  /**
   * Format tools for OpenAI API
   */
  private formatTools(tools?: ToolDefinition[]): OpenAITool[] | undefined {
    if (!tools?.length) return undefined;

    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * Format messages for OpenAI API
   */
  private formatMessages(messages: LLMMessage[]): OpenAIMessage[] {
    return messages.map(msg => {
      const formatted: OpenAIMessage = {
        role: msg.role
      };

      if (msg.role === 'tool') {
        formatted.tool_call_id = msg.toolCallId;
        formatted.content = msg.content;
      } else if (msg.toolCalls && msg.toolCalls.length > 0) {
        formatted.tool_calls = msg.toolCalls.map((tc: ToolCall) => {
          let args: string;
          if (typeof tc.arguments === 'string') {
            args = tc.arguments;
          } else if (tc.arguments && Object.keys(tc.arguments).length > 0) {
            args = JSON.stringify(tc.arguments);
          } else {
            args = '{}';
          }

          return {
            id: tc.id || '',
            type: 'function',
            function: {
              name: tc.name || '',
              arguments: args
            }
          };
        });
        if (msg.content) {
          formatted.content = msg.content;
        }
      } else {
        formatted.content = msg.content;
      }

      return formatted;
    });
  }

  async chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    model?: string,
    options?: { maxTokens?: number; temperature?: number; reasoning?: boolean; signal?: AbortSignal }
  ): Promise<LLMResponse> {
    const url = `${this.apiBase || this.baseURL}/chat/completions`;
    const modelName = model || this.getDefaultModel();
    const startedAt = Date.now();

    this.log.debug('Provider request started', {
      model: modelName,
      apiBase: this.apiBase || this.baseURL,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
      reasoning: options?.reasoning === true
    });

    try {
      const formattedMessages = this.formatMessages(messages);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey || ''}`
      };
      
      if (this.headers) {
        Object.assign(headers, this.headers);
      }

      const requestBody: Record<string, unknown> = {
        model: modelName,
        messages: formattedMessages,
        tools: this.formatTools(tools)
      };

      if (options?.reasoning === true) {
        requestBody.enable_thinking = true;
        requestBody.thinking = { type: 'enabled' };
      }

      if (this.extraBody) {
        Object.assign(requestBody, this.extraBody);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: options?.signal
      });

      const data = await response.json() as OpenAIResponse;

      if (!response.ok) {
        this.log.error(`API Error: ${response.status} ${response.statusText}`, {
          status: response.status,
          statusText: response.statusText,
          response: data
        });
        throw new Error(data.error?.message || `API Error: ${response.status} ${response.statusText}`);
      }

      if (data.error) {
        this.log.error(`Response Error:`, data.error);
        throw new Error(data.error.message || 'OpenAI API error');
      }

      const content = data.choices?.[0]?.message?.content || null;
      const reasoning_content = data.choices?.[0]?.message?.reasoning_content || null;
      const toolCalls = data.choices?.[0]?.message?.tool_calls || [];
      const finishReason = data.choices?.[0]?.finish_reason || 'stop';
      const usage = data.usage;
      const durationMs = Date.now() - startedAt;

      this.log.info('Provider request completed', {
        model: modelName,
        durationMs,
        finishReason,
        toolCallCount: toolCalls.length,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens
      });

      return {
        content: content ?? undefined,
        reasoning_content: reasoning_content ?? undefined,
        toolCalls: toolCalls.map((tc: OpenAIToolCall) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch (error) {
            this.log.warn('Tool call arguments parse failed', {
              toolName: tc.function.name,
              argumentsPreview: preview(tc.function.arguments),
              error: normalizeError(error)
            });
            args = {};
          }
          return {
            id: tc.id,
            name: tc.function.name,
            arguments: args
          };
        }),
        finishReason,
        usage
      };
    } catch (error: unknown) {
      const message = normalizeError(error);
      this.log.error('Provider request failed', {
        model: modelName,
        durationMs: Date.now() - startedAt,
        retryable: isRetryableError(error),
        error: message
      });
      throw error;
    }
  }

  getDefaultModel(): string {
    return 'gpt-4o';
  }
}
