import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../../src/command/command-registry';
import { registerBuiltinCommands } from '../../../src/command/builtin';
import type { CommandContext, RoleConfig } from '../../../src/core/types';

function makeRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    id: 'default',
    name: 'Default',
    description: 'Default role',
    systemPrompt: 'You are helpful.',
    model: 'openai/gpt-4o',
    toolPermission: { mode: 'allowlist', list: ['*'] },
    skills: ['*'],
    enabled: true,
    ...overrides,
  };
}

function makeContext(): CommandContext {
  return {
    sessionKey: { channel: 'test', type: 'private', chatId: 'user-1' },
  };
}

function createRegistry() {
  const registry = new CommandRegistry();
  const roles = [
    makeRole(),
    makeRole({ id: 'analyst', name: 'Analyst', description: 'Analysis role' }),
  ];
  const session = {
    activeRole: roles[0],
  };
  const deps = {
    sessionManager: {
      clearSession: vi.fn().mockResolvedValue(undefined),
      compactSession: vi.fn().mockResolvedValue('压缩摘要'),
      getOrCreateSession: vi.fn().mockResolvedValue(session),
      switchRole: vi.fn().mockImplementation(async (_key: unknown, roleId: string) => {
        const nextRole = roles.find((role) => role.id === roleId) ?? roles[0];
        session.activeRole = nextRole;
      }),
    },
    roleManager: {
      getEnabledRoles: vi.fn().mockReturnValue(roles),
      getRole: vi
        .fn()
        .mockImplementation(
          (roleId: string) => roles.find((role) => role.id === roleId) ?? roles[0],
        ),
    },
    pluginManager: {
      listPlugins: vi.fn().mockResolvedValue([
        {
          name: 'alpha',
          directoryName: 'plugin_alpha',
          enabled: true,
          state: 'loaded',
          directory: '/plugin_alpha',
          version: '1.0.0',
        },
        {
          name: 'beta',
          directoryName: 'plugin_beta',
          enabled: false,
          state: 'disabled',
          directory: '/plugin_beta',
        },
      ]),
      enable: vi.fn().mockResolvedValue(undefined),
      disable: vi.fn().mockResolvedValue(undefined),
    },
  };

  registerBuiltinCommands(registry, deps);

  return { registry, deps, session };
}

describe('built-in commands', () => {
  it('executes /clear via SessionManager', async () => {
    const { registry, deps } = createRegistry();
    const context = makeContext();

    await expect(registry.execute('/clear', context)).resolves.toBe('当前会话历史已清除。');
    expect(deps.sessionManager.clearSession).toHaveBeenCalledWith(context.sessionKey);
  });

  it('executes /compact via SessionManager', async () => {
    const { registry, deps } = createRegistry();
    const context = makeContext();

    await expect(registry.execute('/compact', context)).resolves.toContain('压缩摘要');
    expect(deps.sessionManager.compactSession).toHaveBeenCalledWith(context.sessionKey);
  });

  it('executes role commands with real manager logic', async () => {
    const { registry, deps } = createRegistry();
    const context = makeContext();

    await expect(registry.execute('/role list', context)).resolves.toContain('analyst');
    await expect(registry.execute('/role info', context)).resolves.toContain('当前角色：default');
    await expect(registry.execute('/role switch analyst', context)).resolves.toContain('analyst');

    expect(deps.sessionManager.getOrCreateSession).toHaveBeenCalled();
    expect(deps.sessionManager.switchRole).toHaveBeenCalledWith(context.sessionKey, 'analyst');
  });

  it('rejects switching to an unknown role', async () => {
    const { registry, deps } = createRegistry();
    const context = makeContext();

    await expect(registry.execute('/role switch missing', context)).resolves.toBe(
      '未找到可用角色：missing',
    );
    expect(deps.sessionManager.switchRole).not.toHaveBeenCalled();
  });

  it('executes plugin commands with real manager logic', async () => {
    const { registry, deps } = createRegistry();
    const context = makeContext();

    await expect(registry.execute('/plugin list', context)).resolves.toContain('alpha');
    await expect(registry.execute('/plugin enable alpha', context)).resolves.toBe(
      '插件已启用：alpha',
    );
    await expect(registry.execute('/plugin disable beta', context)).resolves.toBe(
      '插件已禁用：beta',
    );

    expect(deps.pluginManager.listPlugins).toHaveBeenCalledTimes(3);
    expect(deps.pluginManager.enable).toHaveBeenCalledWith('alpha');
    expect(deps.pluginManager.disable).toHaveBeenCalledWith('beta');
  });

  it('passes canonical plugin names when commands use directory aliases', async () => {
    const { registry, deps } = createRegistry();
    const context = makeContext();

    await expect(registry.execute('/plugin enable plugin_alpha', context)).resolves.toBe(
      '插件已启用：alpha',
    );
    await expect(registry.execute('/plugin disable plugin_beta', context)).resolves.toBe(
      '插件已禁用：beta',
    );

    expect(deps.pluginManager.enable).toHaveBeenCalledWith('alpha');
    expect(deps.pluginManager.disable).toHaveBeenCalledWith('beta');
  });

  it('rejects enabling or disabling an unknown plugin', async () => {
    const { registry, deps } = createRegistry();
    const context = makeContext();

    await expect(registry.execute('/plugin enable missing', context)).resolves.toBe(
      '未找到插件：missing',
    );
    await expect(registry.execute('/plugin disable missing', context)).resolves.toBe(
      '未找到插件：missing',
    );

    expect(deps.pluginManager.enable).not.toHaveBeenCalled();
    expect(deps.pluginManager.disable).not.toHaveBeenCalled();
  });
});
