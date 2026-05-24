import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { validateWithSchema } from '../../../../src/core/config/schema-utils';

describe('validateWithSchema', () => {
  const TestSchema = Type.Object({
    name: Type.String(),
    count: Type.Number({ default: 0 }),
  });

  it('validates and returns value when valid', () => {
    const result = validateWithSchema<{ name: string; count: number }>(
      TestSchema,
      { name: 'test', count: 42 },
      '测试',
    );
    expect(result).toEqual({ name: 'test', count: 42 });
  });

  it('applies default values', () => {
    const result = validateWithSchema<{ name: string; count: number }>(
      TestSchema,
      { name: 'test' },
      '测试',
    );
    expect(result).toEqual({ name: 'test', count: 0 });
  });

  it('throws with descriptive error for invalid values', () => {
    expect(() => validateWithSchema(TestSchema, { name: 123 }, '测试')).toThrow('测试验证失败');
  });

  it('throws with specific field path in error', () => {
    try {
      validateWithSchema(TestSchema, { name: 'test', count: 'not-a-number' }, 'Config');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('Config');
      expect(message).toContain('count');
    }
  });
});
