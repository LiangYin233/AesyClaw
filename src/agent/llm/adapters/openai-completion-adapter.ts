import OpenAI from 'openai';
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
} from '../types';
import { ToolDefinition } from '../../../platform/tools/types';
import { logger } from '../../../platform/observability/logger';
import { randomUUID } from 'crypto';

const TOOL_CALL_PATTERN = /<tool_call>\s*name:\s*(\w+)\s*arguments:\s*(\{[^}]+\})\s*<\/tool_call>/gi;

export class OpenAICompletionAdapter implements ILLMProvider {
  readonly providerType = LLMProviderType.OpenAICompletion;
  readonly supportedModes: LLMMode[] = [LLMMode.Completion];

  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: LLMProviderConfig) {
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error('OpenAI API key is required. Please configure it in config.toml.');
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout || 60000,
    });

    this.model = config.model || 'gpt-3.5-turbo-instruct';
    this.maxTokens = config.maxTokens || 2048;
    this.temperature = config.temperature ?? 0.7;

    logger.info(
      { provider: this.providerType, model: this.model, maxTokens: this.maxTokens },
      '🤖 OpenAI Completion Adapter 已初始化'
    );
  }

  validateConfig(): boolean {
    return !!this.client.apiKey;
  }

  async generate(
    messages: StandardMessage[],
    tools?: ToolDefinition[]
  ): Promise<StandardResponse> {
    const prompt = this.buildPrompt(messages, tools);

    logger.debug(
      { promptLength: prompt.length, hasTools: !!tools },
      '📤 发送请求到 OpenAI Completion API'
    );

    try {
      const response = await this.client.completions.create({
        model: this.model,
        prompt,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stop: ['</tool_call>', '\n\n\n'],
      });

      const text = response.choices[0]?.text || '';
      const tokenUsage: TokenUsage | undefined = response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined;

      const toolCalls = this.extractToolCalls(text, tools || []);

      const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';

      logger.info(
        { 
          finishReason, 
          textLength: text.length, 
          toolCallCount: toolCalls.length,
          tokenUsage,
        },
        '📥 收到 OpenAI Completion 响应'
      );

      return {
        text: text.replace(TOOL_CALL_PATTERN, '').trim(),
        toolCalls,
        tokenUsage,
        finishReason,
        rawResponse: response,
      };
    } catch (error) {
      logger.error({ error }, '❌ OpenAI Completion API 调用失败');
      throw error;
    }
  }

  private buildPrompt(messages: StandardMessage[], tools?: ToolDefinition[]): string {
    const parts: string[] = [];

    const systemMessages = messages.filter(m => m.role === MessageRole.System);
    const conversationMessages = messages.filter(m => m.role !== MessageRole.System);

    if (systemMessages.length > 0) {
      parts.push('=== SYSTEM INSTRUCTIONS ===\n');
      for (const msg of systemMessages) {
        parts.push(msg.content);
      }
      parts.push('\n');
    }

    if (tools && tools.length > 0) {
      parts.push('=== AVAILABLE TOOLS ===\n');
      parts.push('You can call one or more functions to assist with the user query.\n\n');
      
      for (const tool of tools) {
        const paramsStr = JSON.stringify(tool.parameters, null, 2);
        parts.push(`## ${tool.name}\n`);
        parts.push(`Description: ${tool.description}\n`);
        parts.push(`Parameters:\n${paramsStr}\n\n`);
      }

      parts.push('=== TOOL CALLING FORMAT ===\n');
      parts.push('When you want to call a tool, respond with:\n');
      parts.push('<tool_call>\n');
      parts.push('name: <function_name>\n');
      parts.push('arguments: <json_arguments>\n');
      parts.push('</tool_call>\n\n');
      parts.push('For multiple calls, use separate <tool_call> blocks.\n\n');
    }

    parts.push('=== CONVERSATION ===\n');
    for (const msg of conversationMessages) {
      if (msg.role === MessageRole.User) {
        parts.push(`User: ${msg.content}\n`);
      } else if (msg.role === MessageRole.Assistant) {
        parts.push(`Assistant: ${msg.content}\n`);
      } else if (msg.role === MessageRole.Tool) {
        parts.push(`[TOOL RESULT: ${msg.content}]\n`);
      }
    }

    parts.push('\nAssistant: ');
    return parts.join('');
  }

  private extractToolCalls(text: string, tools: ToolDefinition[]): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const toolNames = new Set(tools.map(t => t.name));

    let match;
    const pattern = new RegExp(TOOL_CALL_PATTERN.source, 'gi');
    
    while ((match = pattern.exec(text)) !== null) {
      const toolName = match[1];
      const argsStr = match[2];

      if (toolNames.has(toolName)) {
        try {
          const args = JSON.parse(argsStr);
          toolCalls.push({
            id: randomUUID(),
            name: toolName,
            arguments: args,
          });
        } catch {
          logger.warn({ toolName, argsStr }, '⚠️ 无法解析工具参数');
        }
      } else {
        logger.warn({ toolName }, '⚠️ LLM 调用了未注册的工具');
      }
    }

    return toolCalls;
  }
}
