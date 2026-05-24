import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { RolesConfigSchema } from '../../../src/role/role-schema';

describe('RoleConfigSchema', () => {
  it('validates a complete role config', () => {
    const roles = [
      {
        id: 'assistant',
        description: 'Main assistant',
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist', list: ['search', 'read'] },
        skills: ['skill-a'],
        enabled: true,
      },
    ];
    expect(Value.Check(RolesConfigSchema, roles)).toBe(true);
  });

  it('applies default enabled=true', () => {
    const roles = [
      {
        id: 'assistant',
        description: 'Main',
        systemPrompt: 'Be helpful.',
        model: 'openai/gpt-4o-mini',
        toolPermission: { mode: 'denylist', list: [] },
        skills: [],
      },
    ];
    const validated = Value.Default(RolesConfigSchema, roles) as Array<Record<string, unknown>>;
    expect(validated[0].enabled).toBe(true);
  });

  it('rejects missing required fields', () => {
    const roles = [{ id: 'test' }];
    expect(Value.Check(RolesConfigSchema, roles)).toBe(false);
  });

  it('rejects invalid toolPermission mode', () => {
    const roles = [
      {
        id: 'test',
        description: 'Test',
        systemPrompt: 'You are test.',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'invalid', list: [] },
        skills: [],
        enabled: true,
      },
    ];
    expect(Value.Check(RolesConfigSchema, roles)).toBe(false);
  });

  it('accepts skills with wildcard', () => {
    const roles = [
      {
        id: 'test',
        description: 'Test',
        systemPrompt: 'You are test.',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist', list: [] },
        skills: ['*'],
        enabled: true,
      },
    ];
    expect(Value.Check(RolesConfigSchema, roles)).toBe(true);
  });

  it('rejects non-array roles', () => {
    expect(Value.Check(RolesConfigSchema, {})).toBe(false);
    expect(Value.Check(RolesConfigSchema, 'string')).toBe(false);
    expect(Value.Check(RolesConfigSchema, null)).toBe(false);
  });
});
