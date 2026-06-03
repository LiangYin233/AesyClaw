import { describe, expect, it, vi } from 'vitest';
import { RuntimeControlHub } from '../../../src/extension/plugin/control';
import type { WebRuntimeDependencies } from '../../../src/web/types';

function makeDeps(): WebRuntimeDependencies {
  const config = {
    server: { port: 3000, host: '127.0.0.1' },
    providers: {},
    channels: {},
    agent: { defaultModel: 'openai/gpt-4o', memory: { compressionThreshold: 0.8 } },
    mcp: [],
    plugins: {},
  };

  return {
    configManager: {
      get: vi.fn((key: keyof typeof config) => config[key]),
      update: vi.fn(async () => undefined),
      onConfigReloaded: vi.fn(),
    },
    databaseManager: {},
    sessionManager: {},
    cronManager: {},
    roleManager: {},
    channelManager: {},
    pluginManager: {},
    toolRegistry: {},
    skillManager: {},
    agentRegistry: {},
    paths: {},
  } as unknown as WebRuntimeDependencies;
}

describe('RuntimeControlHub', () => {
  it('waits for runtime dependencies before dispatching WebUI protocol requests', async () => {
    const hub = new RuntimeControlHub();
    const responsePromise = hub.dispatch({ type: 'get_config', requestId: 'req-1' });

    expect(hub.isReady()).toBe(false);
    hub.bind(makeDeps());

    await expect(responsePromise).resolves.toMatchObject({
      type: 'get_config',
      ok: true,
      data: {
        server: { port: 3000, host: '127.0.0.1' },
        providers: {},
        channels: {},
        plugins: {},
      },
    });
    expect(hub.isReady()).toBe(true);
  });

  it('emits ready, reset, and config reload events', () => {
    const hub = new RuntimeControlHub();
    const ready = vi.fn();
    const reset = vi.fn();
    const configReloaded = vi.fn();

    const offReady = hub.on('runtime:ready', ready);
    hub.on('runtime:reset', reset);
    hub.on('config:reloaded', configReloaded);

    hub.bind(makeDeps());
    hub.notifyConfigReloaded();
    hub.reset();
    offReady();
    hub.bind(makeDeps());

    expect(ready).toHaveBeenCalledTimes(1);
    expect(configReloaded).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
