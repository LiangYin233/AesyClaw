import type { RoleConfig } from '../../src/core/types';

export function makeRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    id: 'assistant',
    description: 'A helpful assistant',
    systemPrompt: 'You are {{role}}.',
    model: 'openai/gpt-4o',
    toolPermission: { mode: 'allowlist', list: ['*'] },
    skills: ['greeting'],
    enabled: true,
    ...overrides,
  };
}
