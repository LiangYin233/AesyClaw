import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/app';
import { ChannelManager } from '../../src/extension/channel/manager';
import { PluginManager } from '../../src/extension/plugin/manager';
import { CronManager } from '../../src/cron/manager';
import { McpManager } from '../../src/tool/mcp/mcp-manager';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults';

const TEST_ROOTS: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { __aesyclawChannelStarts?: number }).__aesyclawChannelStarts;
  delete (globalThis as { __aesyclawPluginControlReady?: boolean }).__aesyclawPluginControlReady;
  for (const testRoot of TEST_ROOTS.splice(0)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

describe('Application', () => {
  it('starts and shuts down with an isolated runtime root', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'aesyclaw-app-test-'));
    TEST_ROOTS.push(testRoot);
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);

    const app = new Application();

    try {
      await app.start();

      const runtimeRoot = path.join(testRoot, '.aesyclaw');
      const configFile = path.join(runtimeRoot, 'config.json');
      const rolesDir = path.join(runtimeRoot, 'roles');
      const rolesFile = path.join(runtimeRoot, 'roles.json');
      const dbFile = path.join(runtimeRoot, 'data', 'aesyclaw.db');

      expect(existsSync(runtimeRoot)).toBe(true);
      expect(existsSync(configFile)).toBe(true);
      expect(existsSync(rolesDir)).toBe(false);
      expect(existsSync(rolesFile)).toBe(true);
      expect(existsSync(dbFile)).toBe(true);
      expect(JSON.parse(readFileSync(rolesFile, 'utf-8'))).toEqual([
        expect.objectContaining({ id: 'default', enabled: true }),
      ]);
      expect(JSON.parse(readFileSync(configFile, 'utf-8'))).toMatchObject({
        agent: expect.objectContaining({ logLevel: 'info' }),
        plugins: {},
        mcp: [expect.objectContaining({ name: 'example', enabled: false })],
      });
      expect(JSON.parse(readFileSync(configFile, 'utf-8'))).not.toHaveProperty('server');
    } finally {
      await app.shutdown();
    }
  });

  it('binds runtime control before plugin setup', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'aesyclaw-app-test-'));
    TEST_ROOTS.push(testRoot);
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);

    const pluginDir = path.join(testRoot, 'extensions', 'plugin_probe');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      path.join(pluginDir, 'index.js'),
      `export default {
        name: 'probe',
        version: '1.0.0',
        async init(ctx) {
          await ctx.control.status.get();
          globalThis.__aesyclawPluginControlReady = true;
        }
      };\n`,
      'utf-8',
    );

    const app = new Application();

    try {
      await app.start();
      expect((globalThis as { __aesyclawPluginControlReady?: boolean }).__aesyclawPluginControlReady).toBe(
        true,
      );
    } finally {
      await app.shutdown();
    }
  });

  it('starts channels before cron and injects the real send dependency', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'aesyclaw-app-test-'));
    TEST_ROOTS.push(testRoot);
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);

    const order: string[] = [];
    const originalStartAll = ChannelManager.prototype.startAll;
    const originalCronInitialize = CronManager.prototype.initialize;

    vi.spyOn(ChannelManager.prototype, 'startAll').mockImplementation(async function (
      this: ChannelManager,
    ) {
      order.push('channels');
      await originalStartAll.call(this);
    });

    vi.spyOn(CronManager.prototype, 'initialize').mockImplementation(async function (
      this: CronManager,
    ) {
      order.push('cron');
      expect(order).toContain('channels');
      await originalCronInitialize.call(this);
    });

    const app = new Application();

    try {
      await app.start();
      expect(order).toEqual(expect.arrayContaining(['channels', 'cron']));
      expect(order.indexOf('channels')).toBeLessThan(order.indexOf('cron'));
    } finally {
      await app.shutdown();
    }
  });

  it('loads channel extensions before startAll without adding plugin config entries', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'aesyclaw-app-test-'));
    TEST_ROOTS.push(testRoot);
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);

    const channelDir = path.join(testRoot, 'extensions', 'channel_fixture');
    mkdirSync(channelDir, { recursive: true });
    writeFileSync(
      path.join(channelDir, 'index.js'),
      `export default {
        name: 'fixture',
        version: '1.0.0',
        defaultConfig: {},
        async init() { globalThis.__aesyclawChannelStarts = (globalThis.__aesyclawChannelStarts ?? 0) + 1; },
        async receive() {},
        async send() {}
      };\n`,
      'utf-8',
    );
    const runtimeRoot = path.join(testRoot, '.aesyclaw');
    mkdirSync(runtimeRoot, { recursive: true });
    writeFileSync(
      path.join(runtimeRoot, 'config.json'),
      JSON.stringify(
        {
          ...DEFAULT_CONFIG,
          channels: { fixture: { enabled: true } },
          mcp: [],
        },
        null,
        2,
      ),
      'utf-8',
    );

    const app = new Application();

    try {
      await app.start();

      const configFile = path.join(testRoot, '.aesyclaw', 'config.json');
      const config = JSON.parse(readFileSync(configFile, 'utf-8')) as {
        plugins?: Record<string, unknown>;
      };
      expect(
        (globalThis as { __aesyclawChannelStarts?: number }).__aesyclawChannelStarts,
      ).toBeGreaterThanOrEqual(1);
      expect(config.plugins).toEqual({});
    } finally {
      await app.shutdown();
    }
  });

  it('cleans up managers when plugin startup fails', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'aesyclaw-app-test-'));
    TEST_ROOTS.push(testRoot);
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);

    const error = new Error('plugin setup failed');
    const pluginSetup = vi.spyOn(PluginManager.prototype, 'setup').mockRejectedValue(error);
    const pluginDestroy = vi.spyOn(PluginManager.prototype, 'destroy').mockResolvedValue();
    const channelDestroy = vi.spyOn(ChannelManager.prototype, 'destroy').mockResolvedValue();
    const cronDestroy = vi.spyOn(CronManager.prototype, 'destroy').mockResolvedValue();

    const app = new Application();

    await expect(app.start()).rejects.toThrow(error);
    expect(pluginSetup).toHaveBeenCalledTimes(1);
    expect(channelDestroy).toHaveBeenCalledTimes(1);
    expect(pluginDestroy).toHaveBeenCalledTimes(1);
    expect(cronDestroy).toHaveBeenCalledTimes(1);
  });

  it('injects the real MCP client factory', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'aesyclaw-app-test-'));
    TEST_ROOTS.push(testRoot);
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);

    const MockMcpManager = vi
      .spyOn(McpManager.prototype, 'connectAll')
      .mockResolvedValue(undefined);

    const app = new Application();

    try {
      await app.start();
    } finally {
      MockMcpManager.mockRestore();
      await app.shutdown();
    }
  });
});
