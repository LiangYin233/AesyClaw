import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookPipeline, VoidHookPipeline } from '../../src/plugins/HookPipeline';
import type { Plugin } from '../../src/plugins/PluginManager';

function makePlugin(name: string, hooks: Partial<Plugin> = {}): Plugin {
  return {
    name,
    version: '1.0.0',
    ...hooks
  } as Plugin;
}

describe('HookPipeline', () => {
  describe('execute', () => {
    it('should chain plugin hooks sequentially', async () => {
      const plugin1 = makePlugin('p1', {
        onMessage: async (msg: any) => ({ ...msg, step1: true })
      });
      const plugin2 = makePlugin('p2', {
        onMessage: async (msg: any) => ({ ...msg, step2: true })
      });

      const pipeline = new HookPipeline([plugin1, plugin2], 'onMessage');
      const result = await pipeline.execute({ content: 'test' });

      expect(result).toEqual({ content: 'test', step1: true, step2: true });
    });

    it('should skip plugins without the hook', async () => {
      const plugin1 = makePlugin('p1', {
        onMessage: async (msg: any) => ({ ...msg, modified: true })
      });
      const plugin2 = makePlugin('p2'); // no onMessage

      const pipeline = new HookPipeline([plugin1, plugin2], 'onMessage');
      const result = await pipeline.execute({ content: 'test' });

      expect(result).toEqual({ content: 'test', modified: true });
    });

    it('should continue on error in one plugin', async () => {
      const plugin1 = makePlugin('p1', {
        onMessage: async () => { throw new Error('fail'); }
      });
      const plugin2 = makePlugin('p2', {
        onMessage: async (msg: any) => ({ ...msg, ok: true })
      });

      const pipeline = new HookPipeline([plugin1, plugin2], 'onMessage');
      const result = await pipeline.execute({ content: 'test' });

      expect(result).toEqual({ content: 'test', ok: true });
    });

    it('should not update result if hook returns null', async () => {
      const plugin = makePlugin('p1', {
        onMessage: async () => null
      });

      const pipeline = new HookPipeline([plugin], 'onMessage');
      const result = await pipeline.execute({ content: 'original' });

      expect(result).toEqual({ content: 'original' });
    });

    it('should not update result if hook returns undefined', async () => {
      const plugin = makePlugin('p1', {
        onMessage: async () => undefined
      });

      const pipeline = new HookPipeline([plugin], 'onMessage');
      const result = await pipeline.execute({ content: 'original' });

      expect(result).toEqual({ content: 'original' });
    });

    it('should timeout slow hooks', async () => {
      const plugin = makePlugin('slow', {
        onMessage: async () => new Promise(resolve => setTimeout(() => resolve({ done: true }), 1000))
      });

      const pipeline = new HookPipeline([plugin], 'onMessage', { timeout: 50 });
      const result = await pipeline.execute({ content: 'test' });

      // Should return original due to timeout error
      expect(result).toEqual({ content: 'test' });
    }, 10000);

    it('should pass additional args to hooks', async () => {
      const hookFn = vi.fn().mockResolvedValue({ modified: true });
      const plugin = makePlugin('p1', { onMessage: hookFn });

      const pipeline = new HookPipeline([plugin], 'onMessage');
      await pipeline.execute({ content: 'test' }, 'arg1', 'arg2');

      expect(hookFn).toHaveBeenCalledWith({ content: 'test' }, 'arg1', 'arg2');
    });
  });
});

describe('VoidHookPipeline', () => {
  describe('execute', () => {
    it('should call all hooks with same args', async () => {
      const fn1 = vi.fn().mockResolvedValue(undefined);
      const fn2 = vi.fn().mockResolvedValue(undefined);

      const plugin1 = makePlugin('p1', { onStart: fn1 });
      const plugin2 = makePlugin('p2', { onStart: fn2 });

      const pipeline = new VoidHookPipeline([plugin1, plugin2], 'onStart');
      await pipeline.execute('arg1', 'arg2');

      expect(fn1).toHaveBeenCalledWith('arg1', 'arg2');
      expect(fn2).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should skip plugins without the hook', async () => {
      const fn = vi.fn().mockResolvedValue(undefined);
      const plugin1 = makePlugin('p1', { onStart: fn });
      const plugin2 = makePlugin('p2'); // no onStart

      const pipeline = new VoidHookPipeline([plugin1, plugin2], 'onStart');
      await pipeline.execute();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should continue on error', async () => {
      const fn1 = vi.fn().mockRejectedValue(new Error('fail'));
      const fn2 = vi.fn().mockResolvedValue(undefined);

      const plugin1 = makePlugin('p1', { onStop: fn1 });
      const plugin2 = makePlugin('p2', { onStop: fn2 });

      const pipeline = new VoidHookPipeline([plugin1, plugin2], 'onStop');
      await pipeline.execute();

      expect(fn1).toHaveBeenCalled();
      expect(fn2).toHaveBeenCalled();
    });

    it('should timeout slow hooks', async () => {
      const fn = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));

      const plugin = makePlugin('slow', { onStart: fn });
      const pipeline = new VoidHookPipeline([plugin], 'onStart', { timeout: 50 });

      await pipeline.execute(); // Should not throw, just log error
      expect(fn).toHaveBeenCalled();
    }, 10000);
  });
});
