import { describe, expect, it } from 'vitest';
import { estimateApproximateTokens } from '../../../src/session/token-utils';

describe('estimateApproximateTokens', () => {
  it('returns 0 for empty messages array', () => {
    expect(estimateApproximateTokens([])).toBe(0);
  });

  it('estimates tokens for user text messages', () => {
    const messages = [{ role: 'user' as const, content: 'Hello world', timestamp: Date.now() }];
    // 'Hello world' = 11 chars / 3.5 = 3.14 → 4
    expect(estimateApproximateTokens(messages)).toBe(4);
  });

  it('estimates tokens for assistant text messages', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'This is a longer assistant response with more content.' },
        ],
        timestamp: Date.now(),
      },
    ];
    const result = estimateApproximateTokens(messages);
    expect(result).toBeGreaterThan(0);
  });

  it('aggregates tokens across multiple messages', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello', timestamp: Date.now() },
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Hi there!' }],
        timestamp: Date.now(),
      },
      { role: 'user' as const, content: 'How are you?', timestamp: Date.now() },
    ];
    // 'Hello' (5) + 'Hi there!' (9) + 'How are you?' (11) = 25 / 3.5 = 7.14 → 8
    expect(estimateApproximateTokens(messages)).toBe(8);
  });

  it('handles assistant messages with empty text content', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [] as { type: 'text'; text: string }[],
        timestamp: Date.now(),
      },
    ];
    expect(estimateApproximateTokens(messages)).toBe(0);
  });

  it('handles mixed content types (text + toolCall blocks)', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'Some text' },
          { type: 'toolCall' as const, id: 'call-1', name: 'search', arguments: '{}' },
        ],
        timestamp: Date.now(),
      },
    ];
    // Only 'Some text' (9 chars) counts
    expect(estimateApproximateTokens(messages)).toBe(3);
  });
});
