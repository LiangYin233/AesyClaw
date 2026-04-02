import { StandardMessage, MessageRole } from '../../llm/types';
import { TruncationResult, MemoryConfig } from './types';
import { TokenBudgetCalculator } from './token-budget-calculator';

export class MessageTrimmer {
  private config: MemoryConfig;
  private calculator: TokenBudgetCalculator;

  constructor(config: MemoryConfig, calculator: TokenBudgetCalculator) {
    this.config = config;
    this.calculator = calculator;
  }

  updateConfig(config: Partial<MemoryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  checkAndTrim(message: StandardMessage | string): { message: StandardMessage | string; result?: TruncationResult } {
    const content = typeof message === 'string' ? message : message.content;
    const tokens = this.calculator.calculateSingleMessage(content);

    if (tokens < this.config.dangerThreshold) {
      return { message };
    }

    const result = this.trimMessage(content, tokens);
    
    if (typeof message === 'string') {
      return { message: result.preservedHead + result.warningMessage + result.preservedTail, result };
    }

    return {
      message: { ...message, content: result.preservedHead + result.warningMessage + result.preservedTail },
      result,
    };
  }

  trimMessage(content: string, tokens?: number): TruncationResult {
    const originalLength = content.length;
    const estimatedTokens = tokens || this.calculator.calculateSingleMessage(content);

    if (estimatedTokens < this.config.dangerThreshold) {
      return {
        originalLength,
        truncatedLength: originalLength,
        preservedHead: content,
        preservedTail: '',
        warningMessage: '',
        wasTruncated: false,
      };
    }

    const preserveRatio = 0.1;
    const headLength = Math.floor(originalLength * preserveRatio);
    const tailLength = Math.floor(originalLength * preserveRatio);
    const middleStart = headLength;
    const middleEnd = originalLength - tailLength;

    const preservedHead = content.substring(0, headLength);
    const preservedTail = content.substring(middleEnd);
    const truncatedLength = headLength + tailLength;

    const warningMessage = 
      '\n\n...[系统警告：因内容过长，中间部分已被系统物理舍弃。' +
      '若需精细分析，请调用精准过滤工具]...\n\n';

    return {
      originalLength,
      truncatedLength,
      preservedHead,
      preservedTail,
      warningMessage,
      wasTruncated: true,
    };
  }

  trimMessages(messages: StandardMessage[]): StandardMessage[] {
    return messages.map(msg => {
      const result = this.checkAndTrim(msg);
      return result.message as StandardMessage;
    });
  }

  getOriginalLength(message: StandardMessage | string): number {
    return typeof message === 'string' ? message.length : message.content.length;
  }

  getTruncatedLength(result: TruncationResult): number {
    return result.truncatedLength;
  }

  calculateSavings(result: TruncationResult): number {
    return result.originalLength - result.truncatedLength;
  }

  calculateSavingsPercentage(result: TruncationResult): number {
    if (result.originalLength === 0) return 0;
    return (this.calculateSavings(result) / result.originalLength) * 100;
  }
}
