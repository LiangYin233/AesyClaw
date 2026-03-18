import type { LLMMessage, LLMResponse, ToolDefinition } from '../types.js';

/**
 * Abstract base class for LLM providers
 * Implement this class to add support for different LLM APIs
 */
export abstract class LLMProvider {
  /**
   * @param apiKey - API key for authentication
   * @param apiBase - Base URL for API endpoints
   * @param headers - Additional HTTP headers
   * @param extraBody - Additional body parameters for API requests
   */
  constructor(
    _apiKey?: string,
    _apiBase?: string,
    _headers?: Record<string, string>,
    _extraBody?: Record<string, any>
  ) {}

  /**
   * Send a chat completion request to the LLM
   * @param messages - Conversation history
   * @param tools - Available tools/function calling definitions
   * @param model - Model identifier to use
   * @param options - Optional request parameters
   * @returns LLM response with content and/or tool calls
   */
  abstract chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    model?: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      reasoning?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<LLMResponse>;

  /**
   * Get the default model identifier for this provider
   * @returns Default model name
   */
  abstract getDefaultModel(): string;
}
