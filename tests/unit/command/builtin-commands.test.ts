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
    sessionId: 'session-1',
    activeRole: roles[0],
    memory: {
      loadHistory: vi.fn().mockResolvedValue([]),
    },
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
      enablePlugin: vi.fn().mockResolvedValue(undefined),
      disablePlugin: vi.fn().mockResolvedValue(undefined),
    },
    agentEngine: {
      processEphemeral: vi
        .fn()
        .mockResolvedValue({ components: [{ type: 'Plain', text: '临时回答' }] }),
      process: vi.fn(),
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

    await expect(registry.execute('/compact', context)).resolves.toBe('会话已压缩完成。');
    expect(deps.sessionManager.compactSession).toHaveBeenCalledWith(context.sessionKey);
  });

  it('lists executable namespaced command syntax in help', async () => {
    const { registry } = createRegistry();
    const context = makeContext();

    const result = await registry.execute('/help', context);

    expect(result).toContain('/role list');
    expect(result).toContain('/plugin list');
    expect(result).not.toContain('/role:list');
    expect(result).not.toContain('/plugin:list');
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
    expect(deps.pluginManager.enablePlugin).toHaveBeenCalledWith('alpha');
    expect(deps.pluginManager.disablePlugin).toHaveBeenCalledWith('beta');
  });

  it('returns Chinese usage for /btw without arguments', async () => {
    const { registry, deps } = createRegistry();

    await expect(registry.execute('/btw', makeContext())).resolves.toBe('用法：/btw <message>');
    expect(deps.agentEngine.processEphemeral).not.toHaveBeenCalled();
  });

  it('executes /btw through processEphemeral with current session role and memory', async () => {
    const { registry, deps, session } = createRegistry();
    const context = makeContext();

    await expect(registry.execute('/btw hello there', context)).resolves.toBe('临时回答');

    expect(deps.sessionManager.getOrCreateSession).toHaveBeenCalledWith(context.sessionKey);
    expect(deps.agentEngine.processEphemeral).toHaveBeenCalledWith(
      context.sessionKey,
      session.memory,
      session.activeRole,
      'hello there',
    );
    expect(deps.agentEngine.process).not.toHaveBeenCalled();
  });

  it('marks /btw as allowed during agent processing', () => {
    const { registry } = createRegistry();
    const resolved = registry.resolve('/btw hello');

    expect(resolved?.command.allowDuringAgentProcessing).toBe(true);
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

    expect(deps.pluginManager.enablePlugin).toHaveBeenCalledWith('alpha');
    expect(deps.pluginManager.disablePlugin).toHaveBeenCalledWith('beta');
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

    expect(deps.pluginManager.enablePlugin).not.toHaveBeenCalled();
    expect(deps.pluginManager.disablePlugin).not.toHaveBeenCalled();
  });
});
