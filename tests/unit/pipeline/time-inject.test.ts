import { describe, expect, it } from 'vitest';
import { createTimeInjectHook, TIME_INJECT_HOOK_ID } from '../../../src/hook/builtin/time-inject';

describe('createTimeInjectHook', () => {
  it('returns a HookRegistration with the correct chain and id', () => {
    const hook = createTimeInjectHook();
    expect(hook.id).toBe(TIME_INJECT_HOOK_ID);
    expect(hook.chain).toBe('pipeline:beforeLLM');
    expect(hook.priority).toBe(100);
    expect(hook.enabled).toBe(true);
  });

  it('handler injects time information and calls next', async () => {
    const hook = createTimeInjectHook();
    const ctx = {
      message: { components: [{ type: 'Plain' as const, text: 'user message' }] },
      sessionKey: { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' },
    };
    let nextCalled = false;

    const result = await hook.handler(ctx as never, async () => {
      nextCalled = true;
      return { action: 'next' as const };
    });

    expect(nextCalled).toBe(true);
    expect(result).toEqual({ action: 'next' });
    // Should inject the time information component before the user message
    expect(ctx.message.components.length).toBe(2);
    expect(ctx.message.components[0].type).toBe('Plain');
    expect((ctx.message.components[0] as { text: string }).text).toContain('<information>');
    expect((ctx.message.components[0] as { text: string }).text).toContain('The time is now');
    expect(ctx.message.components[1]).toEqual({ type: 'Plain', text: 'user message' });
  });

  it('handler works without next function', async () => {
    const hook = createTimeInjectHook();
    const ctx = {
      message: { components: [{ type: 'Plain' as const, text: 'test' }] },
      sessionKey: { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' },
    };

    const result = await hook.handler(ctx as never);
    expect(result).toEqual({ action: 'next' });
    expect(ctx.message.components.length).toBe(2);
  });
});
