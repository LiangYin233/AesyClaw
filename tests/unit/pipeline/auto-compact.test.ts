import { describe, expect, it } from 'vitest';
import { createAutoCompactHook, AUTO_COMPACT_HOOK_ID } from '../../../src/hook/builtin/auto-compact';

describe('auto-compact', () => {
  it('returns HookRegistration with correct id and chain', () => {
    const hook = createAutoCompactHook({} as never, 0.8);
    expect(hook.id).toBe(AUTO_COMPACT_HOOK_ID);
    expect(hook.chain).toBe('pipeline:beforeLLM');
    expect(hook.enabled).toBe(true);
  });

  it('skips compact when no session is available', async () => {
    const hook = createAutoCompactHook({} as never, 0.8);
    const result = await hook.handler(
      { message: {}, sessionKey: { channel: 't', type: 'p', chatId: '1' } } as never,
      async () => ({ action: 'next' as const }),
    );
    expect(result).toEqual({ action: 'next' });
  });

  it('skips compact when no agent model is set', async () => {
    const hook = createAutoCompactHook({} as never, 0.8);
    const result = await hook.handler(
      {
        message: {},
        sessionKey: { channel: 't', type: 'p', chatId: '1' },
        session: { get: () => [{ role: 'user', content: 'hello' }] },
        role: { model: 'p/m' },
      } as never,
      async () => ({ action: 'next' as const }),
    );
    expect(result).toEqual({ action: 'next' });
  });

  it('calls next and returns its result', async () => {
    const hook = createAutoCompactHook({} as never, 0.8);
    const result = await hook.handler({} as never, async () => ({
      action: 'respond' as const,
      message: { components: [] },
    }));
    expect(result).toEqual({ action: 'respond', message: { components: [] } });
  });
});
