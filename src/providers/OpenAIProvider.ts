import { LLMProvider } from './base.js';
import type { LLMMessage, LLMResponse, ToolDefinition } from '../types.js';
import { logger } from '../logger/index.js';

interface OpenAITool {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export class OpenAIProvider extends LLMProvider {
  private baseURL = 'https://api.openai.com/v1';
  private log = logger.child({ prefix: 'Provider' });

  private formatTools(tools?: ToolDefinition[]): OpenAITool[] | undefined {
    if (!tools?.length) return undefined;
    
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  private formatMessages(messages: LLMMessage[]): any[] {
    return messages.map(msg => {
      const formatted: any = {
        role: msg.role
      };

      if (msg.role === 'tool') {
        formatted.tool_call_id = msg.toolCallId;
        formatted.content = msg.content;
      } else if (msg.toolCalls && msg.toolCalls.length > 0) {
        formatted.tool_calls = msg.toolCalls.map((tc: any) => {
          let args: string;
          if (typeof tc.arguments === 'string') {
            args = tc.arguments;
          } else if (tc.arguments && Object.keys(tc.arguments).length > 0) {
            args = JSON.stringify(tc.arguments);
          } else if (tc.function?.arguments) {
            args = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
          } else {
            args = '{}';
          }
          
          const toolName = tc.name || tc.function?.name;
          
          return {
            id: tc.id,
            type: 'function',
            function: {
              name: toolName,
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
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<LLMResponse> {
    const url = `${this.apiBase || this.baseURL}/chat/completions`;
    const modelName = model || this.getDefaultModel();

    this.log.debug(`Calling OpenAI API: ${url}`);
    this.log.debug(`Model: ${modelName}`);
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

      const requestBody: Record<string, any> = {
        model: modelName,
        messages: formattedMessages,
        tools: this.formatTools(tools)
      };

      if (this.extraBody) {
        Object.assign(requestBody, this.extraBody);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      const data: any = await response.json();

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
        this.log.debug(`Usage: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`);
      }

      return {
        content,
        reasoning_content,
        toolCalls,
        finishReason,
        usage
      };
    } catch (error: any) {
      this.log.error(`Request failed: ${error.message}`);
      throw error;
    }
  }

  getDefaultModel(): string {
    return 'gpt-4o';
  }
}
