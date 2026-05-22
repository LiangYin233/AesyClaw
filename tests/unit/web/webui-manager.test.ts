import { describe, expect, it, vi } from 'vitest';
import { WebUiManager } from '../../../src/web/webui-manager';

// 阻止实际启动服务器
vi.mock('@hono/node-server', () => ({
  serve: vi.fn(() => ({ close: (cb: () => void) => cb?.() })),
}));
vi.mock('../../../src/web/ws/handler', () => ({ createWebSocketServer: vi.fn() }));
vi.mock('../../../src/web/server', () => ({ createApp: vi.fn(() => ({ fetch: vi.fn() })) }));

function makeDeps() {
  return {
    configManager: {
      get: vi.fn((key: string) => {
        if (key === 'server.port') return 3000;
        if (key === 'server.host') return '127.0.0.1';
        if (key === 'server.authToken') return undefined;
        return undefined;
      }),
      set: vi.fn(),
      resolvedPaths: {} as never,
    },
    databaseManager: {} as never,
    sessionManager: {} as never,
    cronManager: {} as never,
    roleManager: {} as never,
    channelManager: {} as never,
    pluginManager: {} as never,
    toolRegistry: {} as never,
    skillManager: {} as never,
    paths: {} as never,
  };
}

describe('WebUiManager', () => {
  it('can be instantiated', () => {
    const manager = new WebUiManager(makeDeps());
    expect(manager).toBeInstanceOf(WebUiManager);
  });

  it('generates auth token when none is configured', async () => {
    const deps = makeDeps();
    const manager = new WebUiManager(deps);
    await manager.initialize();
    expect(deps.configManager.set).toHaveBeenCalledWith('server.authToken', expect.any(String));
    const token = (deps.configManager.set as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(token.length).toBe(64); // 32 bytes hex = 64 chars
  });

  it('uses pre-configured auth token', async () => {
    const deps = makeDeps();
    deps.configManager.get = vi.fn() as never;
    deps.configManager.get = vi.fn((key: string) => {
      if (key === 'server.port') return 3000;
      if (key === 'server.host') return '127.0.0.1';
      if (key === 'server.authToken') return 'pre-set-token';
      return undefined;
    }) as never;
    const manager = new WebUiManager(deps);
    await manager.initialize();
    expect(deps.configManager.set).not.toHaveBeenCalled();
  });

  it('can be destroyed after initialization', async () => {
    const deps = makeDeps();
    const manager = new WebUiManager(deps);
    await manager.initialize();
    await expect(manager.destroy()).resolves.toBeUndefined();
  });

  it('can be destroyed without initialization', async () => {
    const manager = new WebUiManager(makeDeps());
    await expect(manager.destroy()).resolves.toBeUndefined();
  });

  it('is idempotent on initialize', async () => {
    const deps = makeDeps();
    const manager = new WebUiManager(deps);
    await manager.initialize();
    await manager.initialize(); // 第二次调用应跳过
    expect(deps.configManager.set).toHaveBeenCalledTimes(1);
  });
});
