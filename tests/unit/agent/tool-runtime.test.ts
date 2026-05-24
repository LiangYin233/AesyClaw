import { describe, expect, it } from 'vitest';
import {
  calculateToolResultBudget,
  limitToolResultContent,
} from '../../../src/agent/runner/tool-runtime';

function textContent(text: string) {
  return { type: 'text' as const, text };
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
      { role: 'user' as const, content: 'x'.repeat(100_000), timestamp: Date.now() },
    ];
    const budget = calculateToolResultBudget(model, compressionThreshold, longHistory, '');
    // used ~= 100000 / 3.5 ≈ 28571
    // remaining = 64000 - 28571 ≈ 35429
    expect(budget.maxToolResultTokens).toBeLessThan(32000);
  });

  it('never goes below 0', () => {
    const hugeHistory = [
      { role: 'user' as const, content: 'x'.repeat(1_000_000), timestamp: Date.now() },
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

  it('truncates content when over budget', () => {
    const result = {
      content: [textContent('a'.repeat(1000))],
      details: {},
      isError: false,
      terminate: false,
    };
    const budget = { maxToolResultTokens: 10, maxToolResultChars: 20 };
    const limited = limitToolResultContent(result, budget);
    expect(limited.content[0].text.length).toBe(20);
    expect((limited.details as Record<string, unknown>).truncated).toBe(true);
    expect((limited.details as Record<string, unknown>).originalContentLength).toBe(1000);
  });

  it('truncates across multiple content blocks', () => {
    const result = {
      content: [textContent('a'.repeat(15)), textContent('b'.repeat(15))],
      details: {},
      isError: false,
      terminate: false,
    };
    const budget = { maxToolResultTokens: 10, maxToolResultChars: 20 };
    const limited = limitToolResultContent(result, budget);
    // first block takes 15 chars, remaining 5 go to second
    expect(limited.content[0].text.length).toBe(15);
    expect(limited.content[1].text.length).toBe(5);
  });

  it('preserves isError and terminate flags', () => {
    const result = {
      content: [textContent('a'.repeat(100))],
      details: {},
      isError: true,
      terminate: true,
    };
    const budget = { maxToolResultTokens: 10, maxToolResultChars: 10 };
    const limited = limitToolResultContent(result, budget);
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
});
