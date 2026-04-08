import { TokenUsage } from '../types.js';

export class TokenUsageMapper {
  static fromOpenAI(usage: any): TokenUsage | undefined {
    if (!usage) {
      return undefined;
    }
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };
  }

  static fromAnthropic(usage: any): TokenUsage | undefined {
    if (!usage) {
      return undefined;
    }
    return {
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      totalTokens: usage.input_tokens + usage.output_tokens,
    };
  }

  static fromCompletion(usage: any): TokenUsage | undefined {
    if (!usage) {
      return undefined;
    }
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };
  }
}
