import { describe, expect, it } from 'vitest';
import {
  makeExtraBodyOnPayload,
  assistantHasToolCalls,
  createUserMessage,
  extractMessageText,
  ApiType,
} from '../../../src/contracts/llm';

describe('ApiType', () => {
  it('defines expected API type constants', () => {
    expect(ApiType.OPENAI_RESPONSES).toBe('openai-responses');
    expect(ApiType.OPENAI_COMPLETIONS).toBe('openai-completions');
    expect(ApiType.ANTHROPIC_MESSAGES).toBe('anthropic-messages');
  });
});

describe('makeExtraBodyOnPayload', () => {
  it('returns undefined when extraBody is empty', () => {
    const model = { extraBody: {} } as never;
    expect(makeExtraBodyOnPayload(model)).toBeUndefined();
  });

  it('returns undefined when extraBody is undefined', () => {
    const model = {} as never;
    expect(makeExtraBodyOnPayload(model)).toBeUndefined();
  });

  it('returns a function that merges extraBody into payload', () => {
    const model = { extraBody: { reasoning: { effort: 'low' } } } as never;
    const fn = makeExtraBodyOnPayload(model);
    expect(fn).toBeDefined();
    const result = fn!({ messages: 'hello' });
    expect(result).toEqual({ messages: 'hello', reasoning: { effort: 'low' } });
  });

  it('preserves non-object payload', () => {
    const model = { extraBody: { key: 'val' } } as never;
    const fn = makeExtraBodyOnPayload(model)!;
    expect(fn(null)).toBeNull();
    expect(fn('string')).toBe('string');
    expect(fn(42)).toBe(42);
  });
});

describe('assistantHasToolCalls', () => {
  it('returns true when assistant message has toolCall content', () => {
    const msg = {
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'thinking' },
        { type: 'toolCall' as const, id: 'tc-1', name: 'search', arguments: '{}' },
      ],
    };
    expect(assistantHasToolCalls(msg)).toBe(true);
  });

  it('returns false when assistant message has only text', () => {
    const msg = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'answer' }],
    };
    expect(assistantHasToolCalls(msg)).toBe(false);
  });

  it('returns false for non-assistant messages', () => {
    const msg = { role: 'user' as const, content: 'hello', timestamp: Date.now() };
    expect(assistantHasToolCalls(msg as never)).toBe(false);
  });
});

describe('createUserMessage', () => {
  it('creates a user message with content and timestamp', () => {
    const msg = createUserMessage('Hello', 1000);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    expect(msg.timestamp).toBe(1000);
  });

  it('uses default timestamp when not provided', () => {
    const before = Date.now();
    const msg = createUserMessage('Hello');
    const after = Date.now();
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.timestamp).toBeLessThanOrEqual(after);
  });
});

describe('extractMessageText', () => {
  it('extracts text from user string message', () => {
    const msg = { role: 'user' as const, content: 'hello', timestamp: Date.now() };
    expect(extractMessageText(msg)).toBe('hello');
  });

  it('extracts text from user array content message', () => {
    const msg = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'hello' }, { type: 'text' as const, text: ' world' }],
      timestamp: Date.now(),
    };
    expect(extractMessageText(msg)).toBe('hello world');
  });

  it('extracts text from assistant message', () => {
    const msg = {
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'Final' },
        { type: 'toolCall' as const, id: 'tc-1', name: 'search', arguments: '{}' },
      ],
    };
    expect(extractMessageText(msg)).toBe('Final');
  });

  it('extracts text from toolResult message', () => {
    const msg = {
      role: 'toolResult' as const,
      content: [{ type: 'text' as const, text: 'result data' }],
      toolName: 'search',
      toolCallId: 'tc-1',
    };
    expect(extractMessageText(msg as never)).toBe('result data');
  });

  it('returns empty string for unknown roles', () => {
    const msg = { role: 'system' as const, content: [{ type: 'text' as const, text: 'sys' }] };
    expect(extractMessageText(msg as never)).toBe('');
  });

  it('returns empty string when content array is empty', () => {
    const msg = { role: 'assistant' as const, content: [] };
    expect(extractMessageText(msg as never)).toBe('');
  });
});
