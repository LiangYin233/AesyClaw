import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '../../../src/contracts/llm';
import { calculateActualTokens } from '../../../src/session/utils/token-utils';

function agentMessage(message: unknown): AgentMessage {
  return message as AgentMessage;
}

describe('calculateActualTokens', () => {
  it('returns 0 for empty messages array', () => {
    expect(calculateActualTokens([])).toBe(0);
  });

  it('calculates tokens from usage field', () => {
    const messages = [
      agentMessage({
        role: 'user',
        content: 'Hello world',
        timestamp: Date.now(),
        usage: { totalTokens: 4 },
      }),
    ];
    expect(calculateActualTokens(messages)).toBe(4);
  });

  it('calculates tokens for assistant messages with usage', () => {
    const messages = [
      agentMessage({
        role: 'assistant',
        content: [
          { type: 'text' as const, text: 'This is a longer assistant response with more content.' },
        ],
        timestamp: Date.now(),
        usage: { totalTokens: 15 },
      }),
    ];
    const result = calculateActualTokens(messages);
    expect(result).toBe(15);
  });

  it('aggregates tokens across multiple messages', () => {
    const messages = [
      agentMessage({
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
        usage: { totalTokens: 2 },
      }),
      agentMessage({
        role: 'assistant',
        content: [{ type: 'text' as const, text: 'Hi there!' }],
        timestamp: Date.now(),
        usage: { totalTokens: 3 },
      }),
      agentMessage({
        role: 'user',
        content: 'How are you?',
        timestamp: Date.now(),
        usage: { totalTokens: 3 },
      }),
    ];
    expect(calculateActualTokens(messages)).toBe(8);
  });

  it('handles assistant messages without usage field', () => {
    const messages = [
      agentMessage({
        role: 'assistant',
        content: [] as { type: 'text'; text: string }[],
        timestamp: Date.now(),
      }),
    ];
    expect(calculateActualTokens(messages)).toBe(0);
  });

  it('handles mixed messages with and without usage', () => {
    const messages = [
      agentMessage({
        role: 'assistant',
        content: [
          { type: 'text' as const, text: 'Some text' },
          { type: 'toolCall' as const, id: 'call-1', name: 'search', arguments: '{}' },
        ],
        timestamp: Date.now(),
        usage: { totalTokens: 4 },
      }),
      agentMessage({
        role: 'user',
        content: 'No usage field',
        timestamp: Date.now(),
      }),
    ];
    // Only the first message with usage is counted
    expect(calculateActualTokens(messages)).toBe(4);
  });
});
