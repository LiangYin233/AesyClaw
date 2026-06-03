import { describe, expect, it, vi } from 'vitest';
import { getConfig, updateConfig } from '../../../src/web/services/config';
import { clearSessionHistory } from '../../../src/web/services/sessions';
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
      update: vi.fn(async (_value: Record<string, unknown>) => undefined),
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

  it('uses atomic config update for partial updates', async () => {
    const deps = makeDeps({});
    const body = {
      providers: { openai: { apiKey: '***', baseUrl: 'https://new.example.test' } },
    };

    await updateConfig(deps, body);

    expect(deps.configManager.update).toHaveBeenCalledWith(body);
    expect(deps.configManager.set).not.toHaveBeenCalled();
    expect(deps.configManager.patch).not.toHaveBeenCalled();
  });
});

describe('sessions service', () => {
  it('clears message history for an existing session', async () => {
    const clearById = vi.fn(async () => undefined);
    const findById = vi.fn(async () => ({ channel: 'desktop', type: 'private', chatId: 'test' }));
    const unregisterAgent = vi.fn();
    const deps = {
      databaseManager: {
        sessions: { findById },
      },
      sessionManager: {
        clearById,
      },
      agentRegistry: {
        unregisterAgent,
      },
    } as unknown as WebUiManagerDependencies;

    await clearSessionHistory(deps, 'session-1');

    expect(findById).toHaveBeenCalledWith('session-1');
    expect(clearById).toHaveBeenCalledWith('session-1');
    expect(unregisterAgent).toHaveBeenCalledWith({
      channel: 'desktop',
      type: 'private',
      chatId: 'test',
    });
  });

  it('propagates missing session errors from SessionManager', async () => {
    const deps = {
      databaseManager: {
        sessions: { findById: vi.fn(async () => null) },
      },
      sessionManager: {
        clearById: vi.fn(async () => {
          throw new Error('会话未找到');
        }),
      },
      agentRegistry: {
        unregisterAgent: vi.fn(),
      },
    } as unknown as WebUiManagerDependencies;

    await expect(clearSessionHistory(deps, 'missing')).rejects.toThrow('会话未找到');
  });
});
