import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '../../../src/extension/plugin/types';
import { dispatchMessage } from '../../../extensions/plugin_webui/ws/dispatcher';

function makeContext(): PluginContext {
  return {
    meta: { name: 'webui', owner: 'plugin:webui', directoryName: 'plugin_webui' },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    paths: {
      runtimeRoot: '/tmp/.aesyclaw',
      dataDir: '/tmp/.aesyclaw/data',
      mediaDir: '/tmp/.aesyclaw/media',
      workspaceDir: '/tmp/.aesyclaw/workspace',
      pluginDir: '/tmp/.aesyclaw/data/extensions/plugin_webui',
    },
    config: {
      self: { get: vi.fn(), set: vi.fn() },
      global: {
        get: vi.fn((path: string) => {
          if (path === 'agent') return { memory: { compressionThreshold: 0.8 } };
          return { path };
        }),
        set: vi.fn(async () => undefined),
      },
    },
    registry: {
      tools: { register: vi.fn() },
      commands: { register: vi.fn() },
    },
    hooks: { register: vi.fn(), unregister: vi.fn() },
    models: { resolve: vi.fn() as never, list: vi.fn(async () => []) },
    control: {
      plugins: {
        list: vi.fn(async () => [{ name: 'example', enabled: true }]),
        definition: vi.fn(async () => ({
          name: 'example',
          version: '0.1.0',
          description: 'Example',
          permissions: { config: { read: ['agent'] } },
          init: vi.fn(),
          destroy: vi.fn(),
          nested: { fn: vi.fn(), value: 'kept' },
        })),
        reload: vi.fn(async () => true) as never,
      },
      channels: {
        list: vi.fn(async () => [{ name: 'desktop', enabled: false }]),
        definition: vi.fn(async () => ({
          name: 'desktop',
          version: '0.1.0',
          streaming: true,
          init: vi.fn(),
          send: vi.fn(),
        })),
        reload: vi.fn(async () => true) as never,
      },
      sessions: {
        list: vi.fn(async () => []),
        getMessages: vi.fn(async () => []),
        clear: vi.fn(),
        delete: vi.fn(),
        setModel: vi.fn(),
        setRole: vi.fn(),
      },
      roles: {
        list: vi.fn(async () => []),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      cron: {
        list: vi.fn(async () => []),
        get: vi.fn(),
        getRuns: vi.fn(async () => []),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        runNow: vi.fn(),
        setEnabled: vi.fn(),
      },
      logs: { query: vi.fn(async () => ({ entries: [], limit: 200 })) },
      usage: { query: vi.fn(), today: vi.fn(), tools: vi.fn() },
      status: { get: vi.fn(async () => ({ app: 'AesyClaw', version: '0', uptime: 1, channels: [], database: {} })) },
      tools: { list: vi.fn(async () => []) },
      skills: { list: vi.fn(async () => []), reload: vi.fn(), getContent: vi.fn() },
    },
  };
}

describe('plugin_webui dispatcher', () => {
  it('returns plugin definitions through ctx.control and strips function fields', async () => {
    const ctx = makeContext();

    const response = await dispatchMessage({ type: 'get_plugins', requestId: 'r1' }, ctx);

    expect(ctx.control.plugins.list).toHaveBeenCalledTimes(1);
    expect(ctx.control.plugins.definition).toHaveBeenCalledWith('example');
    expect(response).toEqual({
      type: 'get_plugins',
      ok: true,
      data: [
        {
          name: 'example',
          version: '0.1.0',
          description: 'Example',
          permissions: { config: { read: ['agent'] } },
          enabled: true,
        },
      ],
    });
  });

  it('toggles plugin enabled state through config.global and reloads the plugin', async () => {
    const ctx = makeContext();

    const response = await dispatchMessage(
      { type: 'set_plugin_enabled', data: { name: 'example', enabled: false } },
      ctx,
    );

    expect(response).toEqual({ type: 'set_plugin_enabled', ok: true });
    expect(ctx.config.global.set).toHaveBeenCalledWith('plugins.example.enabled', false);
    expect(ctx.control.plugins.reload).toHaveBeenCalledWith('example');
  });

  it('updates top-level config sections through ctx.config.global', async () => {
    const ctx = makeContext();

    const response = await dispatchMessage(
      { type: 'update_config', data: { agent: { defaultModel: 'openai/gpt-4o' }, plugins: {} } },
      ctx,
    );

    expect(response).toEqual({ type: 'update_config', ok: true });
    expect(ctx.config.global.set).toHaveBeenCalledWith('agent', {
      memory: { compressionThreshold: 0.8 },
      defaultModel: 'openai/gpt-4o',
    });
    expect(ctx.config.global.set).toHaveBeenCalledWith('plugins', {});
  });
});
