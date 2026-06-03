import { describe, expect, it, vi } from 'vitest';
import { RuntimeControlHub } from '../../../src/extension/plugin/control';

function makeDeps() {
  return {
    configManager: {},
    databaseManager: {
      sessions: {
        findById: vi.fn(),
        setModel: vi.fn(),
        setRole: vi.fn(),
      },
      cronJobs: { findById: vi.fn() },
      cronRuns: { findByJobId: vi.fn() },
      usage: { getStats: vi.fn(), getTodaySummary: vi.fn() },
      toolUsage: { getStats: vi.fn() },
      getStats: vi.fn(() => ({ sessions: 0, messages: 0, cronJobs: 0, usage: 0 })),
    },
    sessionManager: {
      getSummaries: vi.fn(async () => [{ id: 's1', channel: 'desktop', type: 'private', chatId: '1', title: 't', messageCount: 0 }]),
      getMessagesById: vi.fn(async () => []),
      clearById: vi.fn(),
      deleteById: vi.fn(),
    },
    roleManager: {
      getAllRoles: vi.fn(() => []),
      getRole: vi.fn(),
      createRole: vi.fn(),
      saveRole: vi.fn(),
      deleteRole: vi.fn(),
    },
    pluginManager: {
      listEnabledPlugins: vi.fn(() => [{ name: 'webui', enabled: true }]),
      getDefinition: vi.fn((name: string) => ({ name, version: '1.0.0', init: vi.fn() })),
      reload: vi.fn(async () => true),
    },
    channelManager: {
      listEnabledChannels: vi.fn(() => [{ name: 'desktop', enabled: true }]),
      getDefinition: vi.fn((name: string) => ({ name, version: '1.0.0', streaming: false, init: vi.fn(), send: vi.fn() })),
      reload: vi.fn(async () => true),
      listChannels: vi.fn(() => []),
    },
    toolRegistry: { getAll: vi.fn(() => []) },
    skillManager: { getAllSkills: vi.fn(() => []), reload: vi.fn(), getSkill: vi.fn() },
    agentRegistry: {},
    paths: {},
  } as never;
}

describe('RuntimeControlHub', () => {
  it('exposes domain APIs after dependencies are bound', async () => {
    const hub = new RuntimeControlHub();
    hub.bind(makeDeps());

    await expect(hub.plugins.list()).resolves.toEqual([{ name: 'webui', enabled: true }]);
    await expect(hub.channels.list()).resolves.toEqual([{ name: 'desktop', enabled: true }]);
    await expect(hub.sessions.list()).resolves.toEqual([
      { id: 's1', channel: 'desktop', type: 'private', chatId: '1', title: 't', messageCount: 0 },
    ]);
  });

  it('does not expose the old dispatch or event subscription API', () => {
    const hub = new RuntimeControlHub();

    expect('dispatch' in hub).toBe(false);
    expect('on' in hub).toBe(false);
    expect('waitUntilReady' in hub).toBe(false);
  });
});
