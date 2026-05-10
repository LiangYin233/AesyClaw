import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/app';
import { ChannelManager } from '../../src/extension/channel/channel-manager';
import { CronManager } from '../../src/cron/cron-manager';
import { McpManager } from '../../src/mcp/mcp-manager';
import { WebUiManager } from '../../src/web/webui-manager';

const TEST_ROOTS: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { __aesyclawChannelStarts?: number }).__aesyclawChannelStarts;
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
        server: expect.objectContaining({ logLevel: 'info' }),
        plugins: [],
        mcp: [expect.objectContaining({ name: 'example', enabled: false })],
      });
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

    vi.spyOn(ChannelManager.prototype, 'startAll').mockImplementation(async function () {
      order.push('channels');
      await originalStartAll.call(this);
    });

    vi.spyOn(CronManager.prototype, 'initialize').mockImplementation(async function () {
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

  it('initializes cron before exposing WebUI routes', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'aesyclaw-app-test-'));
    TEST_ROOTS.push(testRoot);
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);

    const order: string[] = [];
    const originalCronInitialize = CronManager.prototype.initialize;
    const originalWebUiInitialize = WebUiManager.prototype.initialize;

    vi.spyOn(CronManager.prototype, 'initialize').mockImplementation(async function () {
      order.push('cron');
      await originalCronInitialize.call(this);
    });

    vi.spyOn(WebUiManager.prototype, 'initialize').mockImplementation(async function () {
      order.push('webui');
      expect(order).toContain('cron');
      await originalWebUiInitialize.call(this);
    });

    const app = new Application();

    try {
      await app.start();
      expect(order.indexOf('cron')).toBeLessThan(order.indexOf('webui'));
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
        defaultConfig: { enabled: true },
        async init() { globalThis.__aesyclawChannelStarts = (globalThis.__aesyclawChannelStarts ?? 0) + 1; },
        async receive() {},
        async send() {}
      };\n`,
      'utf-8',
    );

    const app = new Application();

    try {
      await app.start();

      const configFile = path.join(testRoot, '.aesyclaw', 'config.json');
      const config = JSON.parse(readFileSync(configFile, 'utf-8')) as { plugins?: unknown[] };
      expect((globalThis as { __aesyclawChannelStarts?: number }).__aesyclawChannelStarts).toBe(1);
      expect(config.plugins).toEqual([]);
    } finally {
      await app.shutdown();
    }
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
