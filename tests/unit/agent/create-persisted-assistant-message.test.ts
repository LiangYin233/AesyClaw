import { describe, expect, it } from 'vitest';
import { createPersistedAssistantMessage } from '../../../src/agent/types';

describe('createPersistedAssistantMessage', () => {
  it('creates an assistant message with text content', () => {
    const msg = createPersistedAssistantMessage('Hello', 5000);
    expect(msg.role).toBe('assistant');
    expect(msg.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(msg.timestamp).toBe(5000);
    expect(msg.api).toBe('openai-responses');
    expect(msg.provider).toBe('persisted-history');
    expect(msg.model).toBe('persisted-history');
    expect(msg.stopReason).toBe('stop');
  });

  it('uses default timestamp when not provided', () => {
    const before = Date.now();
    const msg = createPersistedAssistantMessage('Hello');
    const after = Date.now();
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.timestamp).toBeLessThanOrEqual(after);
  });

  it('accepts custom usage', () => {
    const usage = {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const msg = createPersistedAssistantMessage('Hello', 1000, usage);
    expect(msg.usage).toEqual(usage);
  });

  it('uses zero usage when not provided', () => {
    const msg = createPersistedAssistantMessage('Hello');
    expect(msg.usage).toMatchObject({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    });
    expect(msg.usage!.cost).toBeDefined();
  });

  it('handles empty content string', () => {
    const msg = createPersistedAssistantMessage('');
    expect(msg.content).toEqual([{ type: 'text', text: '' }]);
  });
});
