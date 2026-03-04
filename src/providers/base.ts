import type { LLMMessage, LLMResponse, ToolDefinition } from '../types.js';

export abstract class LLMProvider {
  constructor(
    protected apiKey?: string,
    protected apiBase?: string,
    protected headers?: Record<string, string>,
    protected extraBody?: Record<string, any>
  ) {}

  abstract chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    model?: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<LLMResponse>;

  abstract getDefaultModel(): string;
}
