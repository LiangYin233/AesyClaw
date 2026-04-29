import { describe, expect, it, vi } from 'vitest';
import { createConfigRouter } from '../../../src/web/routes/config';
import type { WebUiManagerDependencies } from '../../../src/web/webui-manager';

function makeDeps(config: Record<string, unknown>) {
  return {
    configManager: {
      getConfig: vi.fn(() => config),
      update: vi.fn(async (_partial: unknown) => undefined),
    },
  } as unknown as WebUiManagerDependencies;
}

describe('config routes', () => {
  it('preserves existing secret values when a masked sentinel is submitted', async () => {
    const previousConfig = {
      server: { authToken: 'real-token' },
      providers: {
        openai: { apiKey: 'sk-real', baseUrl: 'https://example.test' },
      },
    };
    const deps = makeDeps(previousConfig);
    const router = createConfigRouter(deps);

    const response = await router.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        server: { authToken: '***' },
        providers: {
          openai: { apiKey: '***', baseUrl: 'https://new.example.test' },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(deps.configManager.update).toHaveBeenCalledWith({
      server: { authToken: 'real-token' },
      providers: {
        openai: { apiKey: 'sk-real', baseUrl: 'https://new.example.test' },
      },
    });
  });

  it('omits masked sentinel values for secret keys with no previous value', async () => {
    const deps = makeDeps({ providers: { openai: { baseUrl: 'https://example.test' } } });
    const router = createConfigRouter(deps);

    const response = await router.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providers: {
          openai: { apiKey: '***', baseUrl: 'https://new.example.test' },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(deps.configManager.update).toHaveBeenCalledWith({
      providers: {
        openai: { baseUrl: 'https://new.example.test' },
      },
    });
  });
});
