import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { validateParams } from '../../../src/tool/tool-validator';

describe('validateParams', () => {
  it('accepts valid params matching the schema', () => {
    const schema = Type.Object({ name: Type.String(), count: Type.Number() });
    const result = validateParams(schema, { name: 'test', count: 42 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual({ name: 'test', count: 42 });
    }
  });

  it('applies default values from schema', () => {
    const schema = Type.Object({
      name: Type.String(),
      count: Type.Number({ default: 10 }),
    });
    const result = validateParams(schema, { name: 'test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual({ name: 'test', count: 10 });
    }
  });

  it('rejects missing required fields', () => {
    const schema = Type.Object({ name: Type.String(), count: Type.Number() });
    const result = validateParams(schema, { name: 'test' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('count');
    }
  });

  it('rejects wrong types', () => {
    const schema = Type.Object({ count: Type.Number() });
    const result = validateParams(schema, { count: 'not-a-number' });
    expect(result.success).toBe(false);
  });

  it('rejects null when object is expected', () => {
    const schema = Type.Object({ name: Type.String() });
    const result = validateParams(schema, null);
    expect(result.success).toBe(false);
  });

  it('passes through Unsafe schemas without validation', () => {
    const schema = Type.Unsafe({ type: 'unsafe' } as never);
    const result = validateParams(schema, { anything: 'goes' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual({ anything: 'goes' });
    }
  });

  it('validates nested objects', () => {
    const schema = Type.Object({
      user: Type.Object({ id: Type.Number(), name: Type.String() }),
    });
    const result = validateParams(schema, { user: { id: 1, name: 'Alice' } });
    expect(result.success).toBe(true);
  });

  it('rejects invalid nested objects', () => {
    const schema = Type.Object({
      user: Type.Object({ id: Type.Number(), name: Type.String() }),
    });
    const result = validateParams(schema, { user: { id: 'not-number', name: 'Alice' } });
    expect(result.success).toBe(false);
  });

  it('handles optional properties', () => {
    const schema = Type.Object({
      name: Type.String(),
      description: Type.Optional(Type.String()),
    });
    const result = validateParams(schema, { name: 'test' });
    expect(result.success).toBe(true);
  });

  it('truncates error messages to 3 errors', () => {
    const schema = Type.Object({
      a: Type.Number(),
      b: Type.Number(),
      c: Type.Number(),
      d: Type.Number(),
    });
    const result = validateParams(schema, { a: 'x', b: 'y', c: 'z', d: 'w' });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should contain 3 errors at most
      expect(result.error.split(';').length).toBeLessThanOrEqual(3);
    }
  });

  it('catches exceptions during validation', () => {
    // Malformed schema that causes runtime error during Default/Check
    const badSchema = { type: 'invalid' } as never;
    const result = validateParams(badSchema, {});
    expect(result.success).toBe(false);
  });

  it('validates arrays', () => {
    const schema = Type.Array(Type.String());
    const result = validateParams(schema, ['a', 'b', 'c']);
    expect(result.success).toBe(true);
  });

  it('rejects invalid array elements', () => {
    const schema = Type.Array(Type.Number());
    const result = validateParams(schema, [1, 'not-number', 3]);
    expect(result.success).toBe(false);
  });
});
