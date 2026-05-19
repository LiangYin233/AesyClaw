import { describe, expect, it, vi } from 'vitest';

import { dispatchMessage } from '../../../src/web/ws/dispatcher';

function createDeps() {
  const config = {
    server: { port: 3000, host: '127.0.0.1', authToken: 'server-secret' },
    providers: { openai: { apiKey: 'provider-secret' } },
    channels: { desktop: { port: 9730, authToken: 'desktop-local' } },
    agent: { memory: { compressionThreshold: 4000 } },
    mcp: [],
    plugins: [{ name: 'example', enabled: true, options: { foo: 'bar' } }],
  };
  const configManager = {
    get: vi.fn((key: keyof typeof config) => config[key]),
    set: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
  };

  return { deps: { configManager } as never, configManager, config };
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
    const nextPlugins = [{ name: 'example', enabled: false, options: { foo: 'baz' } }];

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
