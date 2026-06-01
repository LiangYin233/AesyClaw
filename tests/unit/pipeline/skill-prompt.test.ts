import { describe, expect, it, vi } from 'vitest';
import {
  createSkillPromptHook,
  SKILL_PROMPT_HOOK_ID,
} from '../../../src/hook/builtin/skill-prompt';
import type { HookCtx } from '../../../src/hook';
import { makeRole } from '../../helpers/role';

const sessionKey = { channel: 'test', type: 'private', chatId: '1' };

function makeCtx(overrides: Partial<HookCtx> = {}): HookCtx {
  return {
    message: { components: [] },
    sessionKey,
    role: makeRole({ skills: ['research'] }),
    promptSections: [],
    ...overrides,
  };
}

describe('createSkillPromptHook', () => {
  it('returns a prompt build hook registration', () => {
    const hook = createSkillPromptHook({ getSkillsForRole: vi.fn().mockReturnValue([]) });

    expect(hook.id).toBe(SKILL_PROMPT_HOOK_ID);
    expect(hook.chain).toBe('prompt:build');
    expect(hook.enabled).toBe(true);
  });

  it('appends role-available skills to prompt sections', async () => {
    const getSkillsForRole = vi.fn().mockReturnValue([
      {
        name: 'research',
        description: 'Deep research',
        content: 'full instructions',
        isSystem: false,
        filePath: '/skills/research/SKILL.md',
      },
    ]);
    const hook = createSkillPromptHook({ getSkillsForRole });
    const ctx = makeCtx();

    await expect(hook.handler(ctx)).resolves.toEqual({ action: 'next' });

    expect(getSkillsForRole).toHaveBeenCalledWith(ctx.role);
    expect(ctx.promptSections).toHaveLength(1);
    expect(ctx.promptSections?.[0]).toContain('**research**: Deep research');
  });

  it('does nothing when no skills are available', async () => {
    const hook = createSkillPromptHook({ getSkillsForRole: vi.fn().mockReturnValue([]) });
    const ctx = makeCtx();

    await hook.handler(ctx);

    expect(ctx.promptSections).toEqual([]);
  });
});
