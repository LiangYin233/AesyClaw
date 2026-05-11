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

describe('sessions service', () => {
  it('clears message history for an existing session', async () => {
    const sessionKey = { channel: 'onebot', type: 'private', chatId: '42' } as const;
    const deps = {
      sessionManager: {
        clear: vi.fn(async () => undefined),
      },
      databaseManager: {
        sessions: {
          findById: vi.fn(async () => ({ id: 'session-1', ...sessionKey })),
        },
        messages: {
          clearHistory: vi.fn(async () => undefined),
        },
      },
    } as unknown as WebUiManagerDependencies;

    await clearSessionHistory(deps, 'session-1');

    expect(deps.databaseManager.sessions.findById).toHaveBeenCalledWith('session-1');
    expect(deps.databaseManager.messages.clearHistory).toHaveBeenCalledWith('session-1');
    expect(deps.sessionManager.clear).toHaveBeenCalledWith(sessionKey);
  });

  it('rejects clearing a missing session', async () => {
    const deps = {
      databaseManager: {
        sessions: {
          findById: vi.fn(async () => null),
        },
        messages: {
          clearHistory: vi.fn(async () => undefined),
        },
      },
    } as unknown as WebUiManagerDependencies;

    await expect(clearSessionHistory(deps, 'missing')).rejects.toThrow('会话未找到');
    expect(deps.databaseManager.messages.clearHistory).not.toHaveBeenCalled();
  });
});
