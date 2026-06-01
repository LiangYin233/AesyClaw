import { describe, expect, it, vi } from 'vitest';
import { registerRoleBuiltinCommands } from '../../../src/command/builtin/role';
import { CommandRegistry } from '../../../src/command/command-registry';
import type { BuiltinCommandDependencies } from '../../../src/command/builtin/types';
import type { CommandContext, Message } from '../../../src/core/types';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

function textOf(result: Message): string {
  const first = result.components[0];
  return first?.type === 'Plain' ? first.text : '';
}

describe('role command', () => {
  it('does not persist an unknown role id when switching roles', async () => {
    const registry = new CommandRegistry();
    const setRole = vi.fn();

    const deps = {
      roleManager: {
        getAllRoles: vi.fn(() => [
          {
            id: 'default',
            description: 'Default role',
            systemPrompt: 'You are helpful.',
            toolPermission: { mode: 'allowlist' as const, list: ['*'] },
            skills: ['*'] as ['*'],
            enabled: true,
          },
        ]),
        getDefaultRole: vi.fn(() => ({
          id: 'default',
          description: 'Default role',
          systemPrompt: 'You are helpful.',
          toolPermission: { mode: 'allowlist' as const, list: ['*'] },
          skills: ['*'] as ['*'],
          enabled: true,
        })),
      },
      databaseManager: {
        sessions: {
          findByKey: vi.fn(async () => ({ id: 'session-1' })),
          setRole,
        },
      },
      agentRegistry: { getAgent: vi.fn(() => undefined) },
    } as unknown as BuiltinCommandDependencies;

    registerRoleBuiltinCommands(registry, deps);

    const cmd = registry
      .getAll()
      .find((command) => command.namespace === 'role' && command.name === 'switch');
    if (!cmd) throw new Error('role switch command not registered');

    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute(['missing-role'], context);

    expect(textOf(result)).toBe('角色不存在：missing-role');
    expect(setRole).not.toHaveBeenCalled();
  });
});
