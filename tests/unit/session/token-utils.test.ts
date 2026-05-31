import { describe, expect, it } from 'vitest';
import { calculateActualTokens } from '../../../src/session/utils/token-utils';

describe('calculateActualTokens', () => {
  it('returns 0 for empty messages array', () => {
    expect(calculateActualTokens([])).toBe(0);
  });

  it('calculates tokens from usage field', () => {
    const messages = [
      { 
        role: 'user' as const, 
        content: 'Hello world', 
        timestamp: Date.now(),
        usage: { totalTokens: 4 }
      } as any,
    ];
    expect(calculateActualTokens(messages)).toBe(4);
  });

  it('calculates tokens for assistant messages with usage', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'This is a longer assistant response with more content.' },
        ],
        timestamp: Date.now(),
        usage: { totalTokens: 15 }
      } as any,
    ];
    const result = calculateActualTokens(messages);
    expect(result).toBe(15);
  });

  it('aggregates tokens across multiple messages', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello', timestamp: Date.now(), usage: { totalTokens: 2 } } as any,
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Hi there!' }],
        timestamp: Date.now(),
        usage: { totalTokens: 3 }
      } as any,
      { role: 'user' as const, content: 'How are you?', timestamp: Date.now(), usage: { totalTokens: 3 } } as any,
    ];
    expect(calculateActualTokens(messages)).toBe(8);
  });

  it('handles assistant messages without usage field', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [] as { type: 'text'; text: string }[],
        timestamp: Date.now(),
      },
    ];
    expect(calculateActualTokens(messages)).toBe(0);
  });

  it('handles mixed messages with and without usage', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'Some text' },
          { type: 'toolCall' as const, id: 'call-1', name: 'search', arguments: '{}' },
        ],
        timestamp: Date.now(),
        usage: { totalTokens: 4 }
      } as any,
      {
        role: 'user' as const,
        content: 'No usage field',
        timestamp: Date.now(),
      },
    ];
    // Only the first message with usage is counted
    expect(calculateActualTokens(messages)).toBe(4);
  });
});
