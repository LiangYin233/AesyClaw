import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '../../../src/agent/types';
import { calculateToolResultBudget } from '../../../src/agent/runner/tool-runtime';
import { limitToolResultContent } from '../../../src/hook/builtin/tool-result-truncation';

function textContent(text: string) {
  return { type: 'text' as const, text };
}

function agentMessage(message: unknown): AgentMessage {
  return message as AgentMessage;
}

describe('calculateToolResultBudget', () => {
  const model = { contextWindow: 128_000 };
  const compressionThreshold = 0.5;

  it('computes budget for empty history', () => {
    const budget = calculateToolResultBudget(model, compressionThreshold, [], '');
    // compressionLimit = 128000 * 0.5 = 64000
    // used = 0 + 0 = 0
    // remaining = 64000
    // maxToolResultTokens = 32000
    expect(budget.maxToolResultTokens).toBeGreaterThan(0);
    expect(budget.maxToolResultChars).toBe(budget.maxToolResultTokens * 3.5);
  });

  it('reduces budget with long history', () => {
    const longHistory = [
      agentMessage({
        role: 'user',
        content: 'x'.repeat(100_000),
        timestamp: Date.now(),
        usage: { totalTokens: 28571 }, // ~100000 / 3.5
      }),
    ];
    const budget = calculateToolResultBudget(model, compressionThreshold, longHistory, '');
    // compressionLimit = 128000 * 0.5 = 64000
    // used = 28571
    // remaining = 64000 - 28571 = 35429
    // maxToolResultTokens = 35429 * 0.5 = 17714
    expect(budget.maxToolResultTokens).toBe(17714);
    expect(budget.maxToolResultChars).toBe(17714 * 3.5);
  });

  it('never goes below 0', () => {
    const hugeHistory = [
      agentMessage({
        role: 'user',
        content: 'x'.repeat(1_000_000),
        timestamp: Date.now(),
        usage: { totalTokens: 300000 }, // Way over the compression limit
      }),
    ];
    const budget = calculateToolResultBudget(model, compressionThreshold, hugeHistory, '');
    expect(budget.maxToolResultTokens).toBe(0);
    expect(budget.maxToolResultChars).toBe(0);
  });

  it('accounts for current content', () => {
    const emptyHistory: { role: 'user'; content: string; timestamp: number }[] = [];
    const budgetWithContent = calculateToolResultBudget(
      model,
      compressionThreshold,
      emptyHistory,
      'test',
    );
    const budgetWithout = calculateToolResultBudget(model, compressionThreshold, emptyHistory, '');
    expect(budgetWithContent.maxToolResultTokens).toBeLessThan(budgetWithout.maxToolResultTokens);
  });
});

describe('limitToolResultContent', () => {
  it('returns result unchanged when within budget', () => {
    const result = {
      content: [textContent('short')],
      details: {},
      isError: false,
      terminate: false,
    };
    const budget = { maxToolResultTokens: 100, maxToolResultChars: 1000 };
    expect(limitToolResultContent(result, budget)).toBe(result);
  });

  it('truncates content with head, tail, and a visible notice', () => {
    const result = {
      content: [textContent('a'.repeat(1000))],
      details: {},
      isError: false,
      terminate: false,
    };
    const budget = { maxToolResultTokens: 10, maxToolResultChars: 20 };
    const limited = limitToolResultContent(result, budget);
    expect(limited.content).toHaveLength(1);
    expect(limited.content[0].text).toContain('...[中间内容已截断]...');
    expect(limited.content[0].text).toContain('[工具结果已截断：原始 1000 字符，保留 20 字符。]');
    expect((limited.details as Record<string, unknown>).truncated).toBe(true);
    expect((limited.details as Record<string, unknown>).originalContentLength).toBe(1000);
    expect((limited.details as Record<string, unknown>).retainedContentLength).toBe(20);
  });

  it('truncates across multiple content blocks as one readable text result', () => {
    const result = {
      content: [textContent('a'.repeat(15)), textContent('b'.repeat(15))],
      details: {},
      isError: false,
      terminate: false,
    };
    const budget = { maxToolResultTokens: 10, maxToolResultChars: 20 };
    const limited = limitToolResultContent(result, budget);
    expect(limited.content).toHaveLength(1);
    expect(limited.content[0].text.startsWith('a'.repeat(14))).toBe(true);
    expect(limited.content[0].text).toContain('b'.repeat(6));
    expect((limited.details as Record<string, unknown>).originalContentLength).toBe(31);
  });

  it('truncates error results while preserving isError and terminate flags', () => {
    const result = {
      content: [textContent('a'.repeat(100))],
      details: {},
      isError: true,
      terminate: true,
    };
    const budget = { maxToolResultTokens: 10, maxToolResultChars: 10 };
    const limited = limitToolResultContent(result, budget);
    expect(limited.content[0].text).toContain('[工具结果已截断：原始 100 字符，保留 10 字符。]');
    expect(limited.isError).toBe(true);
    expect(limited.terminate).toBe(true);
  });

  it('adds truncation info to existing details', () => {
    const result = {
      content: [textContent('a'.repeat(100))],
      details: { source: 'api' },
      isError: false,
      terminate: false,
    };
    const budget = { maxToolResultTokens: 10, maxToolResultChars: 10 };
    const limited = limitToolResultContent(result, budget);
    expect((limited.details as Record<string, unknown>).source).toBe('api');
    expect((limited.details as Record<string, unknown>).truncated).toBe(true);
  });

  it('keeps a visible notice when the content budget is zero', () => {
    const result = {
      content: [textContent('a'.repeat(100))],
      details: {},
      isError: false,
      terminate: false,
    };
    const limited = limitToolResultContent(result, { maxToolResultTokens: 0, maxToolResultChars: 0 });
    expect(limited.content[0].text).toBe('[工具结果已截断：原始 100 字符，保留 0 字符。]');
    expect((limited.details as Record<string, unknown>).retainedContentLength).toBe(0);
  });
});
