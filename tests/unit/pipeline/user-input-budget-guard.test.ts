import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createUserInputBudgetGuardHook,
  USER_INPUT_BUDGET_GUARD_HOOK_ID,
} from '../../../src/hook/builtin/user-input-budget-guard';

describe('createUserInputBudgetGuardHook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a HookRegistration with the correct chain, priority, and id', () => {
    const hook = createUserInputBudgetGuardHook();

    expect(hook.id).toBe(USER_INPUT_BUDGET_GUARD_HOOK_ID);
    expect(hook.chain).toBe('pipeline:beforeAgent');
    expect(hook.priority).toBe(Number.MAX_SAFE_INTEGER);
    expect(hook.enabled).toBe(true);
  });

  it('passes through when current user input is within budget', async () => {
    const hook = createUserInputBudgetGuardHook();
    const next = vi.fn(async () => ({ action: 'next' as const }));

    const result = await hook.handler(
      createCtx({ currentText: 'x'.repeat(35), contextWindow: 100 }),
      next,
    );

    expect(result).toEqual({ action: 'next' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes through when total usage exceeds compression threshold but still fits context window', async () => {
    const hook = createUserInputBudgetGuardHook();
    const next = vi.fn(async () => ({ action: 'next' as const }));

    const result = await hook.handler(
      createCtx({
        currentText: 'x'.repeat(42),
        contextWindow: 100,
        history: [{ role: 'assistant', content: '', usage: { totalTokens: 70 } }],
      }),
      next,
    );

    expect(result).toEqual({ action: 'next' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('responds and logs a warning when current user input fills the whole context window', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hook = createUserInputBudgetGuardHook();
    const next = vi.fn(async () => ({ action: 'next' as const }));

    const result = await hook.handler(
      createCtx({ currentText: 'x'.repeat(350), contextWindow: 100 }),
      next,
    );

    expect(result).toEqual({
      action: 'respond',
      message: {
        components: [
          {
            type: 'Plain',
            text: '输入内容本身超过当前模型上下文限制，已停止本次处理。请减少输入长度后再试。',
          },
        ],
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('[user-input-budget]');
    expect(warnSpy.mock.calls[0]?.[1]).toMatchObject({
      currentChars: 350,
      availableTokens: 100,
      currentTokens: 100,
      limitTokens: 100,
    });
  });

  it('passes through when history leaves too little absolute context so auto-compact can run', async () => {
    const hook = createUserInputBudgetGuardHook();
    const next = vi.fn(async () => ({ action: 'next' as const }));

    const result = await hook.handler(
      createCtx({
        currentText: 'x'.repeat(35),
        contextWindow: 100,
        history: [{ role: 'assistant', content: '', usage: { totalTokens: 95 } }],
      }),
      next,
    );

    expect(result).toEqual({ action: 'next' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('skips safely when session is unavailable', async () => {
    const hook = createUserInputBudgetGuardHook();
    const next = vi.fn(async () => ({ action: 'next' as const }));
    const ctx = createCtx({ currentText: 'x'.repeat(350), contextWindow: 100 }) as Record<
      string,
      unknown
    >;
    delete ctx['session'];

    const result = await hook.handler(ctx as never, next);

    expect(result).toEqual({ action: 'next' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('skips safely when agent model is unavailable', async () => {
    const hook = createUserInputBudgetGuardHook();
    const next = vi.fn(async () => ({ action: 'next' as const }));
    const ctx = createCtx({ currentText: 'x'.repeat(350), contextWindow: 100 }) as Record<
      string,
      unknown
    >;
    delete ctx['agent'];

    const result = await hook.handler(ctx as never, next);

    expect(result).toEqual({ action: 'next' });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

function createCtx(options: { currentText: string; contextWindow: number; history?: unknown[] }) {
  return {
    message: { components: [{ type: 'Plain' as const, text: options.currentText }] },
    sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    session: {
      get: () => options.history ?? [],
    },
    agent: {
      model: { contextWindow: options.contextWindow },
      modelIdentifier: 'openai/gpt-4o',
    },
  };
}
