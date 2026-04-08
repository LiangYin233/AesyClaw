import { PromptContext } from './prompt-context.js';

export enum MessageRole {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
  Tool = 'tool'
}


export interface StandardMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  content: string;
  error?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StandardResponse {
  text: string;
  toolCalls: ToolCall[];
  tokenUsage?: TokenUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
  rawResponse?: unknown;
}

export enum LLMProviderType {
  OpenAIChat = 'openai-chat',
  OpenAICompletion = 'openai-completion',
  Anthropic = 'anthropic'
}

export enum LLMMode {
  Chat = 'chat',
  Completion = 'completion'
}

export interface LLMProviderConfig {
  provider: LLMProviderType;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}

export interface ILLMProvider {
  readonly providerType: LLMProviderType;
  readonly supportedModes: LLMMode[];

  generate(_context: PromptContext): Promise<StandardResponse>;

  validateConfig(): boolean;
}

export interface IAdapterFactory {
  createAdapter(_config: LLMProviderConfig): ILLMProvider;
}
