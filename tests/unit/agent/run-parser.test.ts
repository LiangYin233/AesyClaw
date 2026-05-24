import { describe, expect, it } from 'vitest';
import {
  createAgentRunResult,
  createCancelledRunResult,
  getFinalAssistantMeta,
  getFinalAssistantUsage,
} from '../../../src/agent/runner/run-parser';

function textContent(text: string) {
  return [{ type: 'text' as const, text }];
}

function toolCallContent(toolName: string) {
  return [{ type: 'toolCall' as const, id: 'tc-1', name: toolName, arguments: '{}' }];
}

function makeAssistant(content: ReturnType<typeof textContent> | ReturnType<typeof toolCallContent>, extra: Record<string, unknown> = {}) {
  return { role: 'assistant' as const, content, timestamp: Date.now(), ...extra };
}

function makeUser(content: string) {
  return { role: 'user' as const, content, timestamp: Date.now() };
}

describe('createAgentRunResult', () => {
  it('extracts last assistant text', () => {
    const messages = [
      makeAssistant(textContent('Final answer')),
    ];
    const result = createAgentRunResult(messages);
    expect(result.lastAssistant).toBe('Final answer');
    expect(result.cancelled).toBe(false);
    expect(result.newMessages).toEqual(messages);
  });

  it('returns null lastAssistant when no assistant messages', () => {
    const messages = [makeUser('hello')];
    const result = createAgentRunResult(messages);
    expect(result.lastAssistant).toBeNull();
  });

  it('returns null lastAssistant when last assistant has only tool calls', () => {
    const messages = [
      makeAssistant(toolCallContent('search')),
    ];
    const result = createAgentRunResult(messages);
    expect(result.lastAssistant).toBeNull();
  });

  it('uses text from the final assistant message', () => {
    const messages = [
      makeAssistant(textContent('First')),
      makeAssistant(textContent('Second')),
      makeUser('interjection'),
      makeAssistant(textContent('Final')),
    ];
    const result = createAgentRunResult(messages);
    expect(result.lastAssistant).toBe('Final');
  });

  it('returns [模型错误] for error stop reason', () => {
    const messages = [
      makeAssistant(textContent(''), { stopReason: 'error', errorMessage: 'API timeout' }),
    ];
    const result = createAgentRunResult(messages);
    expect(result.lastAssistant).toBe('[模型错误: API timeout]');
  });

  it('returns default error message when errorMessage is missing', () => {
    const messages = [
      makeAssistant(textContent(''), { stopReason: 'error' }),
    ];
    const result = createAgentRunResult(messages);
    expect(result.lastAssistant).toBe('[模型错误: 模型调用失败但未返回错误详情]');
  });
});

describe('createCancelledRunResult', () => {
  it('returns empty messages and cancelled=true', () => {
    const result = createCancelledRunResult();
    expect(result.newMessages).toEqual([]);
    expect(result.lastAssistant).toBeNull();
    expect(result.cancelled).toBe(true);
  });
});

describe('getFinalAssistantMeta', () => {
  it('returns metadata for the final assistant message', () => {
    const messages = [
      makeAssistant(textContent('Final'), { stopReason: 'stop' }),
    ];
    const meta = getFinalAssistantMeta(messages);
    expect(meta.lastAssistantRole).toBe('assistant');
    expect(meta.lastAssistantStopReason).toBe('stop');
    expect(meta.lastAssistantTextLength).toBe(5);
  });

  it('returns lastAssistantRole null when no assistant message', () => {
    const messages = [makeUser('hello')];
    const meta = getFinalAssistantMeta(messages);
    expect(meta.lastAssistantRole).toBeNull();
  });
});

describe('getFinalAssistantUsage', () => {
  const fullUsage = {
    input: 100,
    output: 50,
    cacheRead: 10,
    cacheWrite: 5,
    totalTokens: 165,
    cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
  };

  it('extracts usage from the final assistant message', () => {
    const messages = [makeAssistant(textContent('Done'), { usage: fullUsage })];
    const usage = getFinalAssistantUsage(messages);
    expect(usage).toEqual({
      input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    });
  });

  it('returns undefined when no assistant messages', () => {
    const messages = [makeUser('hello')];
    expect(getFinalAssistantUsage(messages)).toBeUndefined();
  });

  it('returns undefined when final assistant has tool calls', () => {
    const messages = [makeAssistant(toolCallContent('search'), { usage: fullUsage })];
    expect(getFinalAssistantUsage(messages)).toBeUndefined();
  });

  it('returns undefined when usage fields are missing', () => {
    const messages = [makeAssistant(textContent('Hi'), { usage: { input: 100 } })];
    expect(getFinalAssistantUsage(messages)).toBeUndefined();
  });

  it('returns usage without cost when cost is missing', () => {
    const messages = [makeAssistant(textContent('Hi'), {
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
    })];
    const usage = getFinalAssistantUsage(messages);
    expect(usage).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 });
    expect(usage?.cost).toBeUndefined();
  });

  it('handles NaN values gracefully', () => {
    const messages = [makeAssistant(textContent('Hi'), {
      usage: { input: NaN, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
    })];
    const usage = getFinalAssistantUsage(messages);
    // NaN is not a finite number → input is undefined → overall undefined
    expect(usage).toBeUndefined();
  });
});
