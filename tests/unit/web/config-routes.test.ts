import { describe, expect, it, vi } from 'vitest';
import { getConfig, updateConfig } from '../../../src/web/services/config';
import type { WebUiManagerDependencies } from '../../../src/web/webui-manager';

function makeDeps(config: Record<string, unknown>) {
  return {
    configManager: {
      getConfig: vi.fn(() => config),
      update: vi.fn(async (_partial: unknown, _options?: unknown) => undefined),
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

  it('passes replaceTopLevelKeys on update', async () => {
    const deps = makeDeps({});
    const body = {
      providers: { openai: { apiKey: '***', baseUrl: 'https://new.example.test' } },
    };

    await updateConfig(deps, body);

    expect(deps.configManager.update).toHaveBeenCalledWith(body, {
      replaceTopLevelKeys: ['channels', 'plugins', 'providers'],
    });
  });
});
