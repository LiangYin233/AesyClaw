export enum MessageRole {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
    Tool = 'tool',
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export enum LLMProviderType {
    OpenAIResponses = 'openai-responses',
    OpenAICompletion = 'openai-completion',
    Anthropic = 'anthropic',
}

export interface ModelCapabilities {
    reasoning: boolean;
}

export interface LLMConfig {
    provider: LLMProviderType;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    capabilities?: ModelCapabilities;
}
