import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '../../../src/contracts/llm';
import {
  calculateActualTokens,
  calculateEstimatedContextTokens,
  calculateEstimatedMessageTokens,
  estimateTextTokens,
} from '../../../src/session/utils/token-utils';

function agentMessage(message: unknown): AgentMessage {
  return message as AgentMessage;
}

describe('estimateTextTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('estimates tokens from text length', () => {
    expect(estimateTextTokens('x'.repeat(7))).toBe(2);
  });
});

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

describe('calculateEstimatedMessageTokens', () => {
  it('prefers actual usage when available', () => {
    const message = agentMessage({
      role: 'user',
      content: 'x'.repeat(3_500),
      timestamp: Date.now(),
      usage: { totalTokens: 12 },
    });

    expect(calculateEstimatedMessageTokens(message)).toBe(12);
  });

  it('estimates user messages without usage', () => {
    const message = agentMessage({
      role: 'user',
      content: 'x'.repeat(35),
      timestamp: Date.now(),
    });

    expect(calculateEstimatedMessageTokens(message)).toBe(10);
  });

  it('estimates tool results without usage', () => {
    const message = agentMessage({
      role: 'toolResult',
      content: [{ type: 'text' as const, text: 'x'.repeat(70) }],
      timestamp: Date.now(),
    });

    expect(calculateEstimatedMessageTokens(message)).toBe(20);
  });

  it('estimates hand-written messages with string content', () => {
    const message = agentMessage({
      role: 'toolResult',
      content: 'x'.repeat(14),
      timestamp: Date.now(),
    });

    expect(calculateEstimatedMessageTokens(message)).toBe(4);
  });
});

describe('calculateEstimatedContextTokens', () => {
  it('combines actual usage, estimated history, and current content', () => {
    const messages = [
      agentMessage({
        role: 'assistant',
        content: [{ type: 'text' as const, text: 'ignored because usage exists' }],
        timestamp: Date.now(),
        usage: { totalTokens: 30 },
      }),
      agentMessage({
        role: 'user',
        content: 'x'.repeat(35),
        timestamp: Date.now(),
      }),
    ];

    expect(calculateEstimatedContextTokens(messages, 'x'.repeat(7))).toBe(42);
  });
});
