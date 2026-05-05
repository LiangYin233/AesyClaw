import { describe, expect, it, vi } from 'vitest';
import { createConfigRouter } from '../../../src/web/routes/config';
import type { WebUiManagerDependencies } from '../../../src/web/webui-manager';

function makeDeps(config: Record<string, unknown>) {
  return {
    configManager: {
      getConfig: vi.fn(() => config),
      update: vi.fn(async (_partial: unknown, _options?: unknown) => undefined),
    },
  } as unknown as WebUiManagerDependencies;
}

describe('config routes', () => {
  it('returns actual config values without masking secrets', async () => {
    const config = {
      server: { authToken: 'real-token' },
      providers: {
        openai: { apiKey: 'sk-real', baseUrl: 'https://example.test' },
      },
    };
    const deps = makeDeps(config);
    const router = createConfigRouter(deps);

    const response = await router.request('/');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: config });
  });

  it('saves submitted values directly without masked sentinel restore logic', async () => {
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
    expect(deps.configManager.update).toHaveBeenCalledWith(
      {
        providers: {
          openai: { apiKey: '***', baseUrl: 'https://new.example.test' },
        },
      },
      { replaceTopLevelKeys: ['channels', 'plugins', 'providers'] },
    );
  });

  it('requests top-level channel and provider replacement so removed entries are not preserved', async () => {
    const deps = makeDeps({
      channels: {
        keep: { enabled: true, token: 'real-token' },
        remove: { enabled: true },
      },
      server: { host: '127.0.0.1' },
    });
    const router = createConfigRouter(deps);

    const response = await router.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channels: {
          keep: { enabled: false, token: '***' },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(deps.configManager.update).toHaveBeenCalledWith(
      {
        channels: {
          keep: { enabled: false, token: '***' },
        },
      },
      { replaceTopLevelKeys: ['channels', 'plugins', 'providers'] },
    );
  });

  it('requests top-level provider replacement so removed model presets are not preserved', async () => {
    const deps = makeDeps({
      providers: {
        openai: {
          apiType: 'openai-responses',
          models: { keep: {}, remove: {} },
        },
      },
    });
    const router = createConfigRouter(deps);

    const response = await router.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providers: {
          openai: { apiType: 'openai-responses', models: { keep: {} } },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(deps.configManager.update).toHaveBeenCalledWith(
      {
        providers: {
          openai: { apiType: 'openai-responses', models: { keep: {} } },
        },
      },
      { replaceTopLevelKeys: ['channels', 'plugins', 'providers'] },
    );
  });
});
