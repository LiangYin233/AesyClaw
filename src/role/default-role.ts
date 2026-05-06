import type { RoleConfig } from '@aesyclaw/core/types';

export const DEFAULT_ROLE_CONFIG = {
  id: 'default',
  description: 'A general-purpose AI assistant role with full tool access.',
  systemPrompt:
    'You are AesyClaw, a helpful and versatile AI assistant.\n\nCurrent date: {{date}}\nPlatform: {{os}}\nSystem language: {{systemLang}}\n\nFollow instructions carefully and use available tools when needed.',
  model: 'openai/gpt-4o',
  toolPermission: {
    mode: 'allowlist',
    list: ['*'],
  },
  skills: ['*'],
} satisfies Omit<RoleConfig, 'enabled'>;

export const DEFAULT_ROLES_CONFIG: RoleConfig[] = [{ ...DEFAULT_ROLE_CONFIG, enabled: true }];
