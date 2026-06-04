import { describe, expect, it } from 'vitest';
import {
  createAutoCompactHook,
  AUTO_COMPACT_HOOK_ID,
} from '../../../src/hook/builtin/auto-compact';

describe('auto-compact', () => {
  it('returns HookRegistration with correct id and chain', () => {
    const hook = createAutoCompactHook({} as never, 0.8);
    expect(hook.id).toBe(AUTO_COMPACT_HOOK_ID);
    expect(hook.chain).toBe('agent:beforeLLM');
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

  it('compacts when history lacks usage but estimated text exceeds threshold', async () => {
    const persisted = [{ role: 'user', content: 'x'.repeat(350) }];
    const summary = [{ role: 'assistant', usage: { totalTokens: 10 } }];
    const session = {
      get: () => persisted,
      compact: async () => undefined,
    };
    const hook = createAutoCompactHook({} as never, 0.8);
    let compacted = false;
    session.compact = async () => {
      compacted = true;
      session.get = () => summary;
    };

    const ctx = {
      message: { components: [{ type: 'Plain', text: 'short' }] },
      sessionKey: { channel: 't', type: 'p', chatId: '1' },
      session,
      agent: { model: { contextWindow: 100 }, modelIdentifier: 'p/m' },
      role: { id: 'assistant' },
      llmHistory: persisted,
      llmContent: 'short',
    } as never;
    const result = await hook.handler(ctx, async () => ({ action: 'next' as const }));

    expect(result).toEqual({ action: 'next' });
    expect(compacted).toBe(true);
    expect((ctx as { llmHistory: unknown[] }).llmHistory).toEqual(summary);
  });

  it('compacts when current llmContent exceeds threshold', async () => {
    const persisted = [{ role: 'assistant', usage: { totalTokens: 1 } }];
    const summary = [{ role: 'assistant', usage: { totalTokens: 10 } }];
    const session = {
      get: () => persisted,
      compact: async () => undefined,
    };
    const hook = createAutoCompactHook({} as never, 0.8);
    let compacted = false;
    session.compact = async () => {
      compacted = true;
      session.get = () => summary;
    };

    const ctx = {
      message: { components: [{ type: 'Plain', text: 'fallback should not be used' }] },
      sessionKey: { channel: 't', type: 'p', chatId: '1' },
      session,
      agent: { model: { contextWindow: 100 }, modelIdentifier: 'p/m' },
      role: { id: 'assistant' },
      llmHistory: persisted,
      llmContent: 'x'.repeat(350),
    } as never;
    const result = await hook.handler(ctx, async () => ({ action: 'next' as const }));

    expect(result).toEqual({ action: 'next' });
    expect(compacted).toBe(true);
  });

  it('does not compact when estimated tokens are below threshold', async () => {
    const persisted = [{ role: 'user', content: 'short' }];
    const session = {
      get: () => persisted,
      compact: async () => undefined,
    };
    const hook = createAutoCompactHook({} as never, 0.8);
    let compacted = false;
    session.compact = async () => {
      compacted = true;
    };

    const ctx = {
      message: { components: [{ type: 'Plain', text: 'short' }] },
      sessionKey: { channel: 't', type: 'p', chatId: '1' },
      session,
      agent: { model: { contextWindow: 100 }, modelIdentifier: 'p/m' },
      role: { id: 'assistant' },
      llmHistory: persisted,
      llmContent: 'short',
    } as never;
    const result = await hook.handler(ctx, async () => ({ action: 'next' as const }));

    expect(result).toEqual({ action: 'next' });
    expect(compacted).toBe(false);
  });

  it('refreshes llmHistory after compacting persisted session history', async () => {
    const persisted = [{ role: 'assistant', usage: { totalTokens: 90 } }];
    const summary = [{ role: 'assistant', usage: { totalTokens: 10 } }];
    const transient = [{ role: 'toolResult', content: 'large result' }];
    const session = {
      get: () => persisted,
      compact: async () => undefined,
    };
    const hook = createAutoCompactHook({} as never, 0.8);
    let compacted = false;
    session.compact = async () => {
      compacted = true;
      session.get = () => summary;
    };

    const ctx = {
      message: { components: [] },
      sessionKey: { channel: 't', type: 'p', chatId: '1' },
      session,
      agent: { model: { contextWindow: 100 }, modelIdentifier: 'p/m' },
      role: { id: 'assistant' },
      llmHistory: persisted.concat(transient),
    } as never;
    const result = await hook.handler(ctx, async () => ({ action: 'next' as const }));

    expect(result).toEqual({ action: 'next' });
    expect(compacted).toBe(true);
    expect((ctx as { llmHistory: unknown[] }).llmHistory).toEqual(summary.concat(transient));
  });
});
