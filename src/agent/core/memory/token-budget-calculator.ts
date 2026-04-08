import { StandardMessage } from '../../llm/types.js';
import { TokenBudget, MemoryConfig } from './types.js';
import { RoleUtils } from '../role-utils.js';

export class TokenBudgetCalculator {
  private config: MemoryConfig;
  private tokenCache: Map<string, number> = new Map();

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  updateConfig(config: Partial<MemoryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  calculate(messages: StandardMessage[]): TokenBudget {
    const totalTokens = this.calculateTotalTokens(messages);
    const usagePercentage = (totalTokens / this.config.maxContextTokens) * 100;
    const compressionThresholdTokens = this.config.maxContextTokens * this.config.compressionThreshold;
    const needsCompression = totalTokens >= compressionThresholdTokens;

    return {
      currentTokens: totalTokens,
      maxTokens: this.config.maxContextTokens,
      usagePercentage,
      needsCompression,
    };
  }

  calculateTotalTokens(messages: StandardMessage[]): number {
    let totalTokens = 0;

    for (const message of messages) {
      const cached = this.tokenCache.get(message.content);
      if (cached !== undefined) {
        totalTokens += cached;
      } else {
        const tokens = this.estimateTokens(message);
        this.tokenCache.set(message.content, tokens);
        totalTokens += tokens;
      }
    }

    const overheadPerMessage = 4;
    totalTokens += messages.length * overheadPerMessage;

    return totalTokens;
  }

  calculateSingleMessage(message: StandardMessage | string): number {
    const content = typeof message === 'string' ? message : message.content;
    
    const cached = this.tokenCache.get(content);
    if (cached !== undefined) {
      return cached;
    }

    const tokens = this.estimateTokensFromString(content);
    this.tokenCache.set(content, tokens);
    return tokens;
  }

  private estimateTokens(message: StandardMessage): number {
    const content = message.content;
    let tokens = this.estimateTokensFromString(content);

    if (message.toolCalls) {
      const toolCallsStr = JSON.stringify(message.toolCalls);
      tokens += this.estimateTokensFromString(toolCallsStr) * 0.5;
    }

    tokens += RoleUtils.getTokenWeight(message.role);

    return Math.ceil(tokens);
  }

  private estimateTokensFromString(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = text.split(/\s+/).length;
    const specialChars = (text.match(/[^\w\s\u4e00-\u9fff]/g) || []).length;

    const chineseTokens = chineseChars * 1.5;
    const englishTokens = englishWords * 0.75;
    const specialTokens = specialChars * 0.5;

    const total = chineseTokens + englishTokens + specialTokens;
    return Math.ceil(total);
  }

  needsCompression(tokens: number): boolean {
    const compressionThresholdTokens = this.config.maxContextTokens * this.config.compressionThreshold;
    return tokens >= compressionThresholdTokens;
  }

  clearCache(): void {
    this.tokenCache.clear();
  }

  getCacheSize(): number {
    return this.tokenCache.size;
  }
}
