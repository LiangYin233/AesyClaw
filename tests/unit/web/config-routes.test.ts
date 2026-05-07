import { describe, expect, it, vi } from 'vitest';
import { getConfig, updateConfig } from '../../../src/web/services/config';
import type { WebUiManagerDependencies } from '../../../src/web/webui-manager';

function makeDeps(config: Record<string, unknown>) {
  return {
    configManager: {
      get: vi.fn((path: string) => {
        if (path === 'server') return config.server;
        if (path === 'providers') return config.providers;
        if (path === 'channels') return config.channels;
        if (path === 'agent') return config.agent;
        if (path === 'mcp') return config.mcp;
        if (path === 'plugins') return config.plugins;
        return undefined;
      }),
      set: vi.fn(async (_path: string, _value: unknown) => undefined),
      patch: vi.fn(async (_path: string, _value: Record<string, unknown>) => undefined),
    },
  } as unknown as WebUiManagerDependencies;
}

describe('config service', () => {
  it('returns config values from config manager', async () => {
    const config = {
      server: { authToken: 'real-token' },
      providers: {
        openai: { apiKey: 'sk-real', baseUrl: 'https://example.test' },
      },
    };
    const deps = makeDeps(config);
    const result = getConfig(deps);

    expect(result).toEqual(config);
  });

  it('uses set for providers update', async () => {
    const deps = makeDeps({});
    const body = {
      providers: { openai: { apiKey: '***', baseUrl: 'https://new.example.test' } },
    };

    await updateConfig(deps, body);

    expect(deps.configManager.set).toHaveBeenCalledWith('providers', body.providers);
  });
});
