import { describe, expect, it, vi } from 'vitest';

import { dispatchMessage } from '../../../src/web/ws/dispatcher';

function createDeps() {
  const config = {
    server: { port: 3000, host: '127.0.0.1', authToken: 'server-secret' },
    providers: { openai: { apiKey: 'provider-secret' } },
    channels: { desktop: { port: 9730, authToken: 'desktop-local' } },
    agent: { memory: { compressionThreshold: 4000 } },
    mcp: [],
    // Plugins stored as Record (object) format matching actual config structure
    plugins: {
      example: { enabled: true, foo: 'bar' },
      exec: { enabled: true },
    },
  };
  const configManager = {
    get: vi.fn((key: keyof typeof config) => config[key]),
    set: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
  };
  const channelManager = {
    getRegisteredChannels: vi.fn(async () => ['onebot', 'desktop']),
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
  };
  const pluginManager = {
    getPluginDefinitions: vi.fn(async () => [
      { name: 'example', version: '0.1.0', description: 'Example plugin' },
      { name: 'exec', version: '0.1.0', description: 'Shell exec plugin' },
    ]),
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
  };

  return {
    deps: { configManager, channelManager, pluginManager } as never,
    configManager,
    config,
  };
}

describe('web ws dispatcher config protocol', () => {
  it('uses the shared WebUI get_config protocol', async () => {
    const { deps, config } = createDeps();

    const response = await dispatchMessage({ type: 'get_config', requestId: 'req-1' }, deps);

    expect(response).toEqual({
      type: 'get_config',
      ok: true,
      data: config,
    });
  });

  it('uses the shared WebUI update_config protocol for partial updates', async () => {
    const { deps, configManager } = createDeps();
    // Plugins sent as Record (object) format matching frontend object format
    const nextPlugins = { example: { enabled: false, foo: 'baz' } };

    const response = await dispatchMessage(
      {
        type: 'update_config',
        requestId: 'req-2',
        data: { plugins: nextPlugins },
      },
      deps,
    );

    expect(response).toEqual({ type: 'update_config', ok: true });
    expect(configManager.set).toHaveBeenCalledTimes(1);
    expect(configManager.set).toHaveBeenCalledWith('plugins', nextPlugins);
  });
});

describe('web ws dispatcher plugin protocol', () => {
  it('returns plugin definitions via get_plugins', async () => {
    const { deps } = createDeps();

    const response = await dispatchMessage({ type: 'get_plugins', requestId: 'req-3' }, deps);

    expect(response).toEqual({
      type: 'get_plugins',
      ok: true,
      data: [
        { name: 'example', version: '0.1.0', description: 'Example plugin' },
        { name: 'exec', version: '0.1.0', description: 'Shell exec plugin' },
      ],
    });
  });

  it('enables a plugin via set_plugin_enabled', async () => {
    const { deps } = createDeps();

    const response = await dispatchMessage(
      {
        type: 'set_plugin_enabled',
        requestId: 'req-4',
        data: { name: 'example', enabled: true },
      },
      deps,
    );

    expect(response).toEqual({ type: 'set_plugin_enabled', ok: true });
  });

  it('disables a plugin via set_plugin_enabled', async () => {
    const { deps } = createDeps();

    const response = await dispatchMessage(
      {
        type: 'set_plugin_enabled',
        requestId: 'req-5',
        data: { name: 'example', enabled: false },
      },
      deps,
    );

    expect(response).toEqual({ type: 'set_plugin_enabled', ok: true });
  });

  it('returns channels via get_channels', async () => {
    const { deps } = createDeps();

    const response = await dispatchMessage({ type: 'get_channels', requestId: 'req-6' }, deps);

    expect(response).toEqual({
      type: 'get_channels',
      ok: true,
      data: ['onebot', 'desktop'],
    });
  });

  it('enables a channel via set_channel_enabled', async () => {
    const { deps } = createDeps();

    const response = await dispatchMessage(
      {
        type: 'set_channel_enabled',
        requestId: 'req-7',
        data: { name: 'onebot', enabled: true },
      },
      deps,
    );

    expect(response).toEqual({ type: 'set_channel_enabled', ok: true });
  });

  it('disables a channel via set_channel_enabled', async () => {
    const { deps } = createDeps();

    const response = await dispatchMessage(
      {
        type: 'set_channel_enabled',
        requestId: 'req-8',
        data: { name: 'desktop', enabled: false },
      },
      deps,
    );

    expect(response).toEqual({ type: 'set_channel_enabled', ok: true });
  });
});
