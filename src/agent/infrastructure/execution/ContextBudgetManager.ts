import type { LLMMessage, ToolDefinition } from '../../../types.js';

const DEFAULT_RESERVED_OUTPUT_TOKENS = 4096;
const MIN_RESERVED_OUTPUT_TOKENS = 512;
const CHARS_PER_TOKEN = 4;
const IMAGE_TOKEN_COST = 256;
const MESSAGE_OVERHEAD_TOKENS = 8;
const TRUNCATED_TOOL_HEAD_CHARS = 160;
const TRUNCATED_TOOL_TAIL_CHARS = 80;

export interface ContextBudgetOptions {
  maxContextTokens?: number;
  reservedOutputTokens?: number;
}

export class ContextBudgetManager {
  fit(messages: LLMMessage[], tools: ToolDefinition[], options: ContextBudgetOptions): LLMMessage[] {
    if (!options.maxContextTokens || options.maxContextTokens <= 0) {
      return messages;
    }

    const reservedOutputTokens = this.resolveReservedOutputTokens(
      options.maxContextTokens,
      options.reservedOutputTokens
    );
    const inputBudget = Math.max(1, options.maxContextTokens - reservedOutputTokens);
    const fittedMessages = messages.map((message) => ({ ...message }));

    if (this.estimateTotalTokens(fittedMessages, tools) <= inputBudget) {
      return fittedMessages;
    }

    const protectedIndices = this.getProtectedIndices(fittedMessages);

    for (let index = 0; index < fittedMessages.length; index++) {
      if (this.estimateTotalTokens(fittedMessages, tools) <= inputBudget) {
        break;
      }

      if (protectedIndices.has(index)) {
        continue;
      }

      const message = fittedMessages[index];
      if (message?.role !== 'tool' || typeof message.content !== 'string') {
        continue;
      }

      fittedMessages[index] = {
        ...message,
        content: this.truncateToolContent(message.content)
      };
    }

    while (this.estimateTotalTokens(fittedMessages, tools) > inputBudget) {
      const removalIndex = this.findRemovalCandidate(fittedMessages, protectedIndices);
      if (removalIndex === -1) {
        break;
      }
      fittedMessages.splice(removalIndex, 1);
      this.rebaseProtectedIndices(protectedIndices, removalIndex);
    }

    return fittedMessages;
  }

  private estimateTotalTokens(messages: LLMMessage[], tools: ToolDefinition[]): number {
    return this.estimateMessagesTokens(messages) + this.estimateToolsTokens(tools);
  }

  estimateMessagesTokens(messages: LLMMessage[]): number {
    return messages.reduce((total, message) => total + this.estimateMessageTokens(message), 0);
  }

  private estimateMessageTokens(message: LLMMessage): number {
    let total = MESSAGE_OVERHEAD_TOKENS;

    total += this.estimateStringTokens(message.role);
    total += this.estimateStringTokens(message.name);
    total += this.estimateStringTokens(message.toolCallId);

    if (typeof message.content === 'string') {
      total += this.estimateStringTokens(message.content);
    } else if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (item.type === 'text') {
          total += this.estimateStringTokens(item.text);
        } else if (item.type === 'image_url') {
          total += IMAGE_TOKEN_COST;
          total += this.estimateStringTokens(item.image_url?.url, 16);
        }
      }
    }

    if (Array.isArray(message.toolCalls)) {
      total += this.estimateStringTokens(JSON.stringify(message.toolCalls));
    }

    return total;
  }

  private estimateToolsTokens(tools: ToolDefinition[]): number {
    if (tools.length === 0) {
      return 0;
    }

    return this.estimateStringTokens(JSON.stringify(tools), 32);
  }

  private estimateStringTokens(value?: string, overhead = 0): number {
    if (!value) {
      return overhead;
    }

    return Math.ceil(value.length / CHARS_PER_TOKEN) + overhead;
  }

  private resolveReservedOutputTokens(maxContextTokens: number, reservedOutputTokens?: number): number {
    if (typeof reservedOutputTokens === 'number' && reservedOutputTokens > 0) {
      return reservedOutputTokens;
    }

    return Math.min(
      DEFAULT_RESERVED_OUTPUT_TOKENS,
      Math.max(MIN_RESERVED_OUTPUT_TOKENS, Math.floor(maxContextTokens * 0.1))
    );
  }

  private getProtectedIndices(messages: LLMMessage[]): Set<number> {
    const protectedIndices = new Set<number>();

    const systemIndex = messages.findIndex((message) => message.role === 'system');
    if (systemIndex >= 0) {
      protectedIndices.add(systemIndex);
    }

    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]?.role === 'user') {
        protectedIndices.add(index);
        break;
      }
    }

    return protectedIndices;
  }

  private truncateToolContent(content: string): string {
    if (content.length <= TRUNCATED_TOOL_HEAD_CHARS + TRUNCATED_TOOL_TAIL_CHARS) {
      return content;
    }

    const head = content.slice(0, TRUNCATED_TOOL_HEAD_CHARS);
    const tail = content.slice(-TRUNCATED_TOOL_TAIL_CHARS);
    return [
      '[tool output truncated]',
      `original_length=${content.length}`,
      '',
      '--- head ---',
      head,
      '',
      '--- tail ---',
      tail
    ].join('\n');
  }

  private findRemovalCandidate(messages: LLMMessage[], protectedIndices: Set<number>): number {
    const priorities: Array<LLMMessage['role']> = ['assistant', 'user', 'tool'];

    for (const role of priorities) {
      for (let index = 0; index < messages.length; index++) {
        if (protectedIndices.has(index)) {
          continue;
        }

        if (messages[index]?.role === role) {
          return index;
        }
      }
    }

    return -1;
  }

  private rebaseProtectedIndices(protectedIndices: Set<number>, removedIndex: number): void {
    const next = new Set<number>();
    for (const index of protectedIndices) {
      if (index === removedIndex) {
        continue;
      }

      next.add(index > removedIndex ? index - 1 : index);
    }

    protectedIndices.clear();
    for (const index of next) {
      protectedIndices.add(index);
    }
  }
}
