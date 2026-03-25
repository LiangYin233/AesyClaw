import { preview } from '../../observability/index.js';
import type { LLMMessage, LLMResponse, ToolCall, ToolDefinition } from '../../../types.js';
import type {
  ProviderAdapter,
  ProviderCapabilityProfile,
  ProviderChatOptions,
  ProviderLogContext,
  ProviderRequest,
  ProviderResponseMeta,
  ProviderRuntimeConfig
} from '../core/adapter.js';

interface ResponsesTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ResponsesInputText {
  type: 'input_text';
  text: string;
}

interface ResponsesInputImage {
  type: 'input_image';
  image_url: string;
  detail?: 'auto' | 'low' | 'high';
}

interface ResponsesMessageInput {
  type: 'message';
  role: 'user' | 'assistant';
  content: Array<ResponsesInputText | ResponsesInputImage>;
}

interface ResponsesFunctionCallInput {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

interface ResponsesFunctionCallOutputInput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

type ResponsesInputItem =
  | ResponsesMessageInput
  | ResponsesFunctionCallInput
  | ResponsesFunctionCallOutputInput;

interface ResponsesOutputText {
  type: 'output_text';
  text?: string;
}

interface ResponsesOutputMessage {
  type: 'message';
  role?: string;
  content?: ResponsesOutputText[];
}

interface ResponsesOutputFunctionCall {
  type: 'function_call';
  call_id?: string;
  name?: string;
  arguments?: string;
}

type ResponsesOutputItem =
  | ResponsesOutputMessage
  | ResponsesOutputFunctionCall
  | { type?: string; [key: string]: unknown };

interface ResponsesApiResponse {
  status?: string;
  incomplete_details?: {
    reason?: string;
  } | null;
  output?: ResponsesOutputItem[];
  output_text?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly type = 'openai_responses';
  readonly displayName = 'OpenAI Responses';
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
    config: ProviderRuntimeConfig,
    _context: ProviderLogContext
  ): ProviderRequest {
    const { instructions, input } = this.formatInput(messages);
    const body: Record<string, unknown> = {
      model,
      input,
      tools: this.formatTools(tools),
      store: false,
      parallel_tool_calls: true
    };

    if (instructions) {
      body.instructions = instructions;
    }

    if (options?.reasoning === true) {
      body.reasoning = { effort: 'medium' };
    }

    if (options?.maxTokens !== undefined) {
      body.max_output_tokens = options.maxTokens;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    return {
      path: '/responses',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey || ''}`
      },
      body
    };
  }

  parseResponse(data: unknown, context: ProviderLogContext): LLMResponse {
    const response = isObject(data) ? data as ResponsesApiResponse : {};
    const toolCalls = this.extractToolCalls(response, context);

    return {
      content: this.extractContent(response),
      reasoning_content: undefined,
      toolCalls,
      finishReason: this.mapFinishReason(response),
      usage: response.usage
        ? {
          prompt_tokens: response.usage.input_tokens ?? 0,
          completion_tokens: response.usage.output_tokens ?? 0,
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

  diagnoseEmptyBody(meta: ProviderResponseMeta): string | undefined {
    const hint = this.unsupportedGatewayHint(meta);
    if (!hint) {
      return undefined;
    }

    return `OpenAI Responses API returned an empty response body (${meta.status} ${meta.statusText}). ${hint}`;
  }

  diagnoseInvalidJson(meta: ProviderResponseMeta): string | undefined {
    const hint = this.unsupportedGatewayHint(meta);
    if (!hint) {
      return undefined;
    }

    return `OpenAI Responses API returned invalid JSON: status=${meta.status}, content-type=${meta.contentType}, body=${preview(meta.rawText)}. ${hint}`;
  }

  private formatTools(tools?: ToolDefinition[]): ResponsesTool[] | undefined {
    if (!tools?.length) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  private formatInput(messages: LLMMessage[]): {
    instructions?: string;
    input: ResponsesInputItem[];
  } {
    const input: ResponsesInputItem[] = [];
    let instructions: string | undefined;
    let consumedSystem = false;

    for (const message of messages) {
      if (!consumedSystem && message.role === 'system' && typeof message.content === 'string') {
        instructions = message.content;
        consumedSystem = true;
        continue;
      }

      if (message.role === 'system') {
        continue;
      }

      input.push(...this.formatMessage(message));
    }

    return {
      ...(instructions ? { instructions } : {}),
      input
    };
  }

  private formatMessage(message: LLMMessage): ResponsesInputItem[] {
    if (message.role === 'tool') {
      return [{
        type: 'function_call_output',
        call_id: message.toolCallId || '',
        output: this.stringifyContent(message.content)
      }];
    }

    const items: ResponsesInputItem[] = [];

    if ((message.role === 'user' || message.role === 'assistant') && this.hasVisibleContent(message.content)) {
      items.push({
        type: 'message',
        role: message.role,
        content: this.formatContent(message.content)
      });
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      for (const toolCall of message.toolCalls) {
        items.push({
          type: 'function_call',
          call_id: toolCall.id || '',
          name: toolCall.name || '',
          arguments: this.stringifyArguments(toolCall.arguments)
        });
      }
    }

    return items;
  }

  private hasVisibleContent(content: LLMMessage['content']): boolean {
    if (typeof content === 'string') {
      return content.length > 0;
    }

    return content.length > 0;
  }

  private formatContent(content: LLMMessage['content']): Array<ResponsesInputText | ResponsesInputImage> {
    if (typeof content === 'string') {
      return [{ type: 'input_text', text: content }];
    }

    const items: Array<ResponsesInputText | ResponsesInputImage> = [];
    for (const item of content) {
      if (item.type === 'text' && item.text !== undefined) {
        items.push({ type: 'input_text', text: item.text });
        continue;
      }

      if (item.type === 'image_url' && item.image_url?.url) {
        items.push({
          type: 'input_image',
          image_url: item.image_url.url,
          ...(item.image_url.detail ? { detail: item.image_url.detail } : {})
        });
      }
    }

    return items;
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

  private stringifyArguments(argumentsValue: ToolCall['arguments']): string {
    if (typeof argumentsValue === 'string') {
      return argumentsValue;
    }

    if (argumentsValue && Object.keys(argumentsValue).length > 0) {
      return JSON.stringify(argumentsValue);
    }

    return '{}';
  }

  private extractContent(response: ResponsesApiResponse): string {
    if (typeof response.output_text === 'string' && response.output_text.length > 0) {
      return response.output_text;
    }

    const parts: string[] = [];
    for (const item of response.output || []) {
      if (item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) {
        continue;
      }

      for (const contentItem of item.content) {
        if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
          parts.push(contentItem.text);
        }
      }
    }

    return parts.join('\n');
  }

  private extractToolCalls(response: ResponsesApiResponse, context: ProviderLogContext): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    for (const item of response.output || []) {
      if (!this.isFunctionCallItem(item)) {
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        context.warn('工具调用参数解析失败', {
          toolName: item.name,
          argumentsPreview: preview(item.arguments ?? '')
        });
        args = {};
      }

      toolCalls.push({
        id: item.call_id || '',
        name: item.name || '',
        arguments: args
      });
    }

    return toolCalls;
  }

  private mapFinishReason(response: ResponsesApiResponse): string {
    if (response.status === 'completed') {
      return 'stop';
    }

    return response.incomplete_details?.reason || response.status || 'stop';
  }

  private unsupportedGatewayHint(meta: ProviderResponseMeta): string | undefined {
    const raw = meta.rawText.trim().toLowerCase();
    const htmlLike = meta.contentType.includes('text/html') || raw.startsWith('<!doctype html') || raw.startsWith('<html');
    const missingBody = meta.rawText.trim().length === 0;
    const unsupportedStatus = meta.status === 404 || meta.status === 405;
    const nonJsonSuccess = meta.status === 200 && meta.contentType !== '(missing)' && !meta.contentType.includes('json');

    if (!missingBody && !htmlLike && !unsupportedStatus && !nonJsonSuccess) {
      return undefined;
    }

    return 'This API base may not support the OpenAI Responses `/responses` endpoint. Use provider type `openai` for chat-completions-only gateways, or switch to an API base that supports Responses.';
  }

  private isFunctionCallItem(item: ResponsesOutputItem): item is ResponsesOutputFunctionCall {
    return item.type === 'function_call';
  }
}
