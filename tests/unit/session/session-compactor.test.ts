import { describe, expect, it } from 'vitest';
import { extractMessageText } from '../../../src/contracts/llm';

const xMsg = extractMessageText as (m: unknown) => string;

describe('session compactor transcript logic', () => {
  it('extracts text from user messages for transcript', () => {
    const msg = { role: 'user' as const, content: 'Hello', timestamp: Date.now() };
    const line = `${msg.role.toUpperCase()}: ${xMsg(msg).trim()}`;
    expect(line).toBe('USER: Hello');
  });

  it('extracts text from assistant messages for transcript', () => {
    const msg = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Hi there' }],
      timestamp: Date.now(),
    };
    const line = `${msg.role.toUpperCase()}: ${xMsg(msg).trim()}`;
    expect(line).toBe('ASSISTANT: Hi there');
  });

  it('handles empty content (trim results in empty text)', () => {
    const msg = { role: 'user' as const, content: '', timestamp: Date.now() };
    const text = xMsg(msg).trim();
    expect(text).toBe('');
  });

  it('handles assistant messages with mixed content (text + tool calls)', () => {
    const msg = {
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'Searching...' },
        { type: 'toolCall' as const, id: 'tc-1', name: 'search', arguments: '{}' },
      ],
      timestamp: Date.now(),
    };
    const text = xMsg(msg).trim();
    expect(text).toBe('Searching...');
  });
});
