import { describe, expect, it, vi } from 'vitest';
import { createRolePromptHook, ROLE_PROMPT_HOOK_ID } from '../../../src/hook/builtin/role-prompt';
import type { HookCtx } from '../../../src/hook';
import { makeRole } from '../../helpers/role';

const sessionKey = { channel: 'test', type: 'private', chatId: '1' };

function makeCtx(overrides: Partial<HookCtx> = {}): HookCtx {
  return {
    message: { components: [] },
    sessionKey,
    role: makeRole(),
    promptSections: [],
    isSubAgent: false,
    isCron: false,
    ...overrides,
  };
}

describe('createRolePromptHook', () => {
  it('returns a prompt build hook registration', () => {
    const hook = createRolePromptHook({ getEnabledRoles: vi.fn().mockReturnValue([]) });

    expect(hook.id).toBe(ROLE_PROMPT_HOOK_ID);
    expect(hook.chain).toBe('prompt:build');
    expect(hook.enabled).toBe(true);
  });

  it('appends enabled roles to prompt sections', async () => {
    const getEnabledRoles = vi
      .fn()
      .mockReturnValue([makeRole({ id: 'researcher', description: 'Research role' })]);
    const hook = createRolePromptHook({ getEnabledRoles });
    const ctx = makeCtx();

    await expect(hook.handler(ctx)).resolves.toEqual({ action: 'next' });

    expect(getEnabledRoles).toHaveBeenCalled();
    expect(ctx.promptSections).toHaveLength(1);
    expect(ctx.promptSections?.[0]).toContain('**researcher** — Research role');
  });

  it('skips role injection for sub agents', async () => {
    const getEnabledRoles = vi.fn().mockReturnValue([makeRole({ id: 'helper' })]);
    const hook = createRolePromptHook({ getEnabledRoles });
    const ctx = makeCtx({ isSubAgent: true });

    await hook.handler(ctx);

    expect(getEnabledRoles).not.toHaveBeenCalled();
    expect(ctx.promptSections).toEqual([]);
  });
});
