import { describe, expect, it, vi } from 'vitest';

import { dispatchMessage } from '../../../src/web/ws/dispatcher';

function createDeps() {
  const channels = { desktop: { port: 9730, authToken: 'desktop-local' } };
  const plugins = [{ name: 'example', enabled: true, options: { foo: 'bar' } }];
  const configManager = {
    get: vi.fn((key: string) => {
      switch (key) {
        case 'server':
          return { port: 3000, host: '127.0.0.1', authToken: 'server-secret' };
        case 'providers':
          return { openai: { apiKey: 'provider-secret' } };
        case 'channels':
          return channels;
        case 'agent':
          return { memory: { compressionThreshold: 4000 } };
        case 'mcp':
          return [];
        case 'plugins':
          return plugins;
        default:
          return undefined;
      }
    }),
    set: vi.fn(async () => undefined),
  };

  return { deps: { configManager } as never, configManager, channels, plugins };
}

describe('web ws dispatcher config sections', () => {
  it('returns only the requested config section', async () => {
    const { deps, channels } = createDeps();

    const response = await dispatchMessage(
      { type: 'get_config_section', requestId: 'req-1', data: { sectionKey: 'channels' } },
      deps,
    );

    expect(response).toEqual({
      type: 'get_config_section',
      ok: true,
      data: channels,
    });
  });

  it('updates only the requested config section', async () => {
    const { deps, configManager } = createDeps();
    const nextPlugins = [{ name: 'example', enabled: false, options: { foo: 'baz' } }];

    const response = await dispatchMessage(
      {
        type: 'update_config_section',
        requestId: 'req-2',
        data: { sectionKey: 'plugins', value: nextPlugins },
      },
      deps,
    );

    expect(response).toEqual({ type: 'update_config_section', ok: true });
    expect(configManager.set).toHaveBeenCalledTimes(1);
    expect(configManager.set).toHaveBeenCalledWith('plugins', nextPlugins);
  });
});
