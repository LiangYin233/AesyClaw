import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RoleConfig } from '@aesyclaw/core/types';

export const DEFAULT_ROLE_FILE_NAME = 'default.json';

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

export function ensureDefaultRoleFile(rolesDir: string): void {
  mkdirSync(rolesDir, { recursive: true });

  const defaultRolePath = path.join(rolesDir, DEFAULT_ROLE_FILE_NAME);
  if (existsSync(defaultRolePath)) {
    return;
  }

  writeFileSync(defaultRolePath, `${JSON.stringify(DEFAULT_ROLE_CONFIG, null, 2)}\n`, 'utf-8');
}
