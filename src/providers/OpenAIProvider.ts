import { LLMProvider } from './base.js';
import type { LLMMessage, LLMResponse, ToolDefinition, ToolCall } from '../types.js';
import { logger, normalizeError } from '../logger/index.js';

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
  private log = logger.child({ prefix: 'Provider' });

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

    this.log.debug(`Calling OpenAI API: ${url}`);
    this.log.debug(`Model: ${modelName}`);
    if (options?.reasoning) {
      this.log.debug(`Reasoning enabled`);
    }
    this.log.debug(`Messages: ${messages.length}`);
    if (tools && tools.length > 0) {
      this.log.debug(`Tools: ${tools.map(t => t.name).join(', ')}`);
    }

    try {
      const formattedMessages = this.formatMessages(messages);

      this.log.debug(`Formatted messages count: ${formattedMessages.length}`);
      for (let i = 0; i < formattedMessages.length; i++) {
        const m = formattedMessages[i];
        this.log.debug(`Message[${i}] role: ${m.role}, hasToolCalls: ${!!m.tool_calls}, hasToolCallId: ${!!m.tool_call_id}`);
        if (m.tool_calls) {
          this.log.debug(`  tool_calls:`, JSON.stringify(m.tool_calls).substring(0, 500));
        }
        if (m.tool_call_id) {
          this.log.debug(`  tool_call_id: ${m.tool_call_id}`);
        }
      }
      
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
        this.log.error(`API Error: ${response.status} ${response.statusText}`, data);
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

      this.log.debug(`Response received. Content length: ${content?.length || 0}, Reasoning length: ${reasoning_content?.length || 0}, Tool calls: ${toolCalls.length}, Finish reason: ${finishReason}`);
      if (toolCalls.length > 0) {
        const tcDebug = toolCalls.map((tc: any) => ({
          id: tc.id,
          name: tc.name,
          hasFunction: !!(tc as any).function,
          functionName: (tc as any).function?.name,
          argumentsType: typeof tc.arguments,
          argumentsKeys: tc.arguments ? Object.keys(tc.arguments) : null
        }));
        this.log.debug(`Tool calls detail:`, JSON.stringify(tcDebug).substring(0, 800));
      }
      if (usage) {
        this.log.info(`Token usage: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`);
      }

      return {
        content: content ?? undefined,
        reasoning_content: reasoning_content ?? undefined,
        toolCalls: toolCalls.map((tc: OpenAIToolCall) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch (error) {
            this.log.error(`Failed to parse tool call arguments for ${tc.function.name}: ${tc.function.arguments.substring(0, 200)}`);
            this.log.debug(`Parse error: ${error}`);
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
      this.log.error(`Request failed: ${message}`);
      throw error;
    }
  }

  getDefaultModel(): string {
    return 'gpt-4o';
  }
}
