import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_PROMPT_HOOK_ID,
  createCommunicationPromptHook,
} from '../../../src/hook/builtin/communication-prompt';
import type { HookCtx } from '../../../src/hook';
import { makeRole } from '../../helpers/role';

const sessionKey = { channel: 'test', type: 'private', chatId: '1' };

function makeCtx(overrides: Partial<HookCtx> = {}): HookCtx {
  return {
    message: { components: [] },
    sessionKey,
    role: makeRole(),
    promptSections: [],
    availableToolNames: ['send_msg'],
    isSubAgent: false,
    isCron: false,
    ...overrides,
  };
}

describe('createCommunicationPromptHook', () => {
  it('returns a prompt build hook registration', () => {
    const hook = createCommunicationPromptHook();

    expect(hook.id).toBe(COMMUNICATION_PROMPT_HOOK_ID);
    expect(hook.chain).toBe('prompt:build');
    expect(hook.enabled).toBe(true);
  });

  it('appends communication rules for normal agents', async () => {
    const hook = createCommunicationPromptHook();
    const ctx = makeCtx();

    await expect(hook.handler(ctx)).resolves.toEqual({ action: 'next' });

    expect(ctx.promptSections).toHaveLength(1);
    expect(ctx.promptSections?.[0]).toContain('## 用户沟通');
    expect(ctx.promptSections?.[0]).toContain('send_msg');
  });

  it('skips communication rules when send_msg is unavailable', async () => {
    const hook = createCommunicationPromptHook();
    const ctx = makeCtx({ availableToolNames: [] });

    await hook.handler(ctx);

    expect(ctx.promptSections).toEqual([]);
  });

  it('skips communication rules for sub agents and cron prompts', async () => {
    const hook = createCommunicationPromptHook();
    const subAgentCtx = makeCtx({ isSubAgent: true });
    const cronCtx = makeCtx({ isCron: true });

    await hook.handler(subAgentCtx);
    await hook.handler(cronCtx);

    expect(subAgentCtx.promptSections).toEqual([]);
    expect(cronCtx.promptSections).toEqual([]);
  });
});
