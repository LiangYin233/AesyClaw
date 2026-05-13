/**
 * HooksBus unit tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HooksBus } from '../../../src/hook/hooks-bus';
import type { IHooksBus } from '../../../src/hook/hooks-bus';
import type { HookRegistration, HookCtx } from '../../../src/hook/types';

function makeCtx(overrides: Partial<HookCtx> = {}): HookCtx {
  return {
    message: { components: [] },
    sessionKey: { channel: 'test', type: 'test', chatId: 'test' },
    ...overrides,
  };
}

function makeReg(
  overrides: Partial<HookRegistration> & { id: string; chain: HookRegistration['chain'] },
): HookRegistration {
  return {
    priority: 100,
    enabled: true,
    handler: async (_ctx, next) => (next !== undefined ? await next() : { action: 'next' }),
    ...overrides,
  };
}

describe('HooksBus', () => {
  let bus: IHooksBus;

  beforeEach(() => {
    bus = new HooksBus();
  });

  it('should register and dispatch a hook', async () => {
    let called = false;
    bus.register(
      makeReg({
        id: 'test',
        chain: 'pipeline:receive',
        handler: async () => {
          called = true;
          return { action: 'next' };
        },
      }),
    );
    await bus.dispatch('pipeline:receive', makeCtx());
    expect(called).toBe(true);
  });

  it('should replace a hook with the same id', () => {
    bus.register(makeReg({ id: 'test', chain: 'pipeline:receive', priority: 100 }));
    bus.register(makeReg({ id: 'test', chain: 'pipeline:receive', priority: 50 }));
    // silent replacement — no error
  });

  it('should unregister a hook by id', async () => {
    let called = false;
    bus.register(
      makeReg({
        id: 'test',
        chain: 'pipeline:receive',
        handler: async () => {
          called = true;
          return { action: 'next' };
        },
      }),
    );
    bus.unregister('test');
    await bus.dispatch('pipeline:receive', makeCtx());
    expect(called).toBe(false);
  });

  it('should unregister hooks by prefix', async () => {
    let a = false;
    let b = false;
    bus.register(
      makeReg({
        id: 'p:a1',
        chain: 'pipeline:receive',
        handler: async () => {
          a = true;
          return { action: 'next' };
        },
      }),
    );
    bus.register(
      makeReg({
        id: 'p:a2',
        chain: 'pipeline:receive',
        handler: async () => {
          b = true;
          return { action: 'next' };
        },
      }),
    );
    bus.unregisterByPrefix('p:a');
    await bus.dispatch('pipeline:receive', makeCtx());
    expect(a).toBe(false);
    expect(b).toBe(false);
  });

  it('should skip disabled hooks', async () => {
    let called = false;
    bus.register(
      makeReg({
        id: 'test',
        chain: 'pipeline:receive',
        enabled: false,
        handler: async () => {
          called = true;
          return { action: 'next' };
        },
      }),
    );
    await bus.dispatch('pipeline:receive', makeCtx());
    expect(called).toBe(false);
  });

  it('should enable and disable hooks', () => {
    bus.register(makeReg({ id: 'test', chain: 'pipeline:receive', enabled: false }));
    expect(bus.isEnabled('test')).toBe(false);
    bus.enable('test');
    expect(bus.isEnabled('test')).toBe(true);
    bus.disable('test');
    expect(bus.isEnabled('test')).toBe(false);
  });

  it('should dispatch hooks in priority order', async () => {
    const order: string[] = [];
    const mk = (id: string, pri: number) =>
      makeReg({
        id,
        chain: 'pipeline:receive',
        priority: pri,
        handler: async (_ctx, next) => {
          order.push(id);
          return next !== undefined ? await next() : { action: 'next' };
        },
      });
    bus.register(mk('low', 200));
    bus.register(mk('high', 100));
    await bus.dispatch('pipeline:receive', makeCtx());
    expect(order).toEqual(['high', 'low']);
  });

  it('should short-circuit when a middleware returns block', async () => {
    let secondCalled = false;
    bus.register(
      makeReg({
        id: 'blocker',
        chain: 'pipeline:receive',
        handler: async () => ({ action: 'block', reason: 'nope' }),
      }),
    );
    bus.register(
      makeReg({
        id: 'second',
        chain: 'pipeline:receive',
        handler: async () => {
          secondCalled = true;
          return { action: 'next' };
        },
      }),
    );
    const result = await bus.dispatch('pipeline:receive', makeCtx());
    expect(result.action).toBe('block');
    expect(secondCalled).toBe(false);
  });

  it('should short-circuit when a middleware returns respond', async () => {
    let secondCalled = false;
    bus.register(
      makeReg({
        id: 'responder',
        chain: 'pipeline:receive',
        handler: async () => ({
          action: 'respond',
          message: { components: [{ type: 'Plain', text: 'hi' }] },
        }),
      }),
    );
    bus.register(
      makeReg({
        id: 'second',
        chain: 'pipeline:receive',
        handler: async () => {
          secondCalled = true;
          return { action: 'next' };
        },
      }),
    );
    const result = await bus.dispatch('pipeline:receive', makeCtx());
    expect(result.action).toBe('respond');
    expect(secondCalled).toBe(false);
  });

  it('should clear all hooks', async () => {
    let called = false;
    bus.register(
      makeReg({
        id: 'test',
        chain: 'pipeline:receive',
        handler: async () => {
          called = true;
          return { action: 'next' };
        },
      }),
    );
    bus.clear();
    await bus.dispatch('pipeline:receive', makeCtx());
    expect(called).toBe(false);
  });

  it('should return next for empty chains', async () => {
    const result = await bus.dispatch('pipeline:receive', makeCtx());
    expect(result.action).toBe('next');
  });
});
