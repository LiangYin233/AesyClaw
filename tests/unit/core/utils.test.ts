import { describe, expect, it } from 'vitest';
import { errorMessage, isRecord, mergeDefaults, parseModelIdentifier } from '../../../src/core/utils';

describe('errorMessage', () => {
  it('extracts message from Error instances', () => {
    expect(errorMessage(new Error('test error'))).toBe('test error');
  });

  it('converts non-Error to string', () => {
    expect(errorMessage('raw string')).toBe('raw string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage({ key: 'val' })).toBe('[object Object]');
  });
});

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ key: 'val' })).toBe(true);
    expect(isRecord(new (class {})())).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isRecord('string')).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('mergeDefaults', () => {
  it('merges top-level keys', () => {
    const result = mergeDefaults({ a: 1, b: 2 }, { b: 3, c: 4 });
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('deeply merges nested objects', () => {
    const result = mergeDefaults(
      { server: { port: 3000, host: 'localhost' } },
      { server: { port: 4000 } },
    );
    expect(result).toEqual({ server: { port: 4000, host: 'localhost' } });
  });

  it('does not overwrite when overwrite is false', () => {
    const result = mergeDefaults({ a: 1, b: 2 }, { a: 99 }, { overwrite: false });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('adds new keys when overwrite is false', () => {
    const result = mergeDefaults({ a: 1 }, { b: 2 }, { overwrite: false });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('overwrites arrays entirely (not deep merge)', () => {
    const result = mergeDefaults({ items: [1, 2] }, { items: [3] });
    expect(result).toEqual({ items: [3] });
  });

  it('handles empty overrides', () => {
    const result = mergeDefaults({ a: 1 }, {});
    expect(result).toEqual({ a: 1 });
  });

  it('handles null source values by overwriting', () => {
    const result = mergeDefaults({ a: 1 }, { a: null as unknown as Record<string, unknown> });
    expect(result).toEqual({ a: null });
  });

  it('preserves deeply nested unchanged branches', () => {
    const defaults = { level1: { level2: { a: 1, b: 2 }, c: 3 }, d: 4 };
    const overrides = { level1: { level2: { b: 99 } } };
    const result = mergeDefaults(defaults, overrides);
    expect(result).toEqual({ level1: { level2: { a: 1, b: 99 }, c: 3 }, d: 4 });
  });

  it('does not mutate the defaults object', () => {
    const defaults = { a: { nested: 1 } };
    const overrides = { a: { nested: 2 } };
    const result = mergeDefaults(defaults, overrides);
    expect(result).toEqual({ a: { nested: 2 } });
    expect(defaults).toEqual({ a: { nested: 1 } }); // unchanged
  });
});

describe('parseModelIdentifier', () => {
  it('parses "provider/modelId" format', () => {
    const result = parseModelIdentifier('openai/gpt-4o');
    expect(result).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
  });

  it('parses multi-part model IDs', () => {
    const result = parseModelIdentifier('anthropic/claude-sonnet-4-20250514');
    expect(result).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' });
  });

  it('throws for missing slash', () => {
    expect(() => parseModelIdentifier('invalid')).toThrow('模型标识符格式无效');
  });

  it('returns empty provider for /model format', () => {
    const result = parseModelIdentifier('/model');
    expect(result.provider).toBe('');
    expect(result.modelId).toBe('model');
  });

  it('returns empty model for provider/ format', () => {
    const result = parseModelIdentifier('provider/');
    expect(result.provider).toBe('provider');
    expect(result.modelId).toBe('');
  });
});
