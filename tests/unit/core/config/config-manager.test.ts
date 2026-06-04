import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigManager } from '../../../../src/core/config/config-manager';

const TEST_BASE = join(tmpdir(), 'aesyclaw-test-config');

function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providers: {},
    channels: {},
    agent: {
      defaultModel: 'openai/gpt-4o',
      logLevel: 'info',
      memory: { compressionThreshold: 0.8 },
    },
    mcp: [],
    plugins: {},
    ...overrides,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExpect(assertion: () => void, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await wait(25);
    }
  }
  throw lastError;
}

async function expectStable(assertion: () => void, durationMs = 300): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    assertion();
    await wait(25);
  }
  assertion();
}

describe('ConfigManager', () => {
  let manager: ConfigManager;
  let testRoot: string;
  let configPath: string;

  beforeEach(() => {
    testRoot = join(TEST_BASE, `test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(testRoot, { recursive: true });
    configPath = join(testRoot, '.aesyclaw', 'config.json');

    manager = new ConfigManager(testRoot);
  });

  afterEach(() => {
    manager.stopHotReload();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  afterAll(() => {
    if (existsSync(TEST_BASE)) {
      rmSync(TEST_BASE, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  describe('load', () => {
    it('should create default config files if they do not exist', () => {
      expect(existsSync(configPath)).toBe(true);
      expect(manager.get('agent.defaultModel')).toBe('openai/gpt-4o');
      expect(manager.get('agent.logLevel')).toBe('info');
      expect(manager.get('agent.memory.compressionThreshold')).toBe(0.8);
      expect(manager.get('server')).toBeUndefined();
    });

    it('should create runtime directories', () => {
      expect(existsSync(join(testRoot, '.aesyclaw'))).toBe(true);
      expect(existsSync(join(testRoot, '.aesyclaw', 'data'))).toBe(true);
      expect(existsSync(join(testRoot, '.aesyclaw', 'media'))).toBe(true);
      expect(existsSync(join(testRoot, '.aesyclaw', 'workspace'))).toBe(true);
    });

    it('should load an existing config file', () => {
      const existingConfig = makeConfig({
        agent: {
          defaultModel: 'test/model',
          logLevel: 'debug',
          memory: { compressionThreshold: 0.7 },
        },
      });
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      manager.stopHotReload();
      manager = new ConfigManager(testRoot);

      expect(manager.get('agent.defaultModel')).toBe('test/model');
      expect(manager.get('agent.logLevel')).toBe('debug');
    });

    it('should throw on invalid JSON', () => {
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, 'not json');

      expect(() => new ConfigManager(testRoot)).toThrow();
    });

    it('should reject stale server config sections', () => {
      const staleConfig = makeConfig({
        server: { port: 3000, host: 'localhost', logLevel: 'info' },
      });
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(staleConfig, null, 2));

      expect(() => new ConfigManager(testRoot)).toThrow(/配置验证失败/);
    });

    it('should reject explicitly invalid values instead of coercing them', () => {
      const invalidConfig = makeConfig({
        agent: {
          defaultModel: 'test/model',
          logLevel: 'info',
          memory: { compressionThreshold: '0.8' },
        },
      });
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => new ConfigManager(testRoot)).toThrow();
    });

    it('should still fill defaults for missing optional fields', () => {
      const partialConfig = makeConfig({
        agent: {
          defaultModel: 'test/model',
          logLevel: 'debug',
          memory: { compressionThreshold: 0.7 },
        },
        mcp: [{ name: 'local', transport: 'stdio' }],
        plugins: { 'example-plugin': { custom: true } },
      });
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(partialConfig, null, 2));

      manager.stopHotReload();
      manager = new ConfigManager(testRoot);

      const mcp = manager.get('mcp') as Array<{ enabled?: boolean }>;
      const plugins = manager.get('plugins') as Record<string, { custom?: boolean }>;
      expect(mcp[0]?.enabled).toBe(true);
      expect(plugins['example-plugin']?.custom).toBe(true);
    });
  });

  describe('path-based get/set/patch', () => {
    it('should read nested values by path', () => {
      expect(manager.get('agent.logLevel')).toBe('info');
      expect(manager.get('agent.memory.compressionThreshold')).toBe(0.8);
      expect(manager.get('missing.path')).toBeUndefined();
    });

    it('should return cloned values from get', () => {
      const agent = manager.get('agent') as { logLevel: string };
      agent.logLevel = 'debug';
      expect(manager.get('agent.logLevel')).toBe('info');
    });

    it('should set a nested scalar path and persist it', async () => {
      await manager.set('agent.logLevel', 'debug');

      expect(manager.get('agent.logLevel')).toBe('debug');
      const fileContent = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        agent: { logLevel?: string };
      };
      expect(fileContent.agent.logLevel).toBe('debug');
    });

    it('should patch object paths by deep merging', async () => {
      await manager.patch('agent', { logLevel: 'debug' });

      expect(manager.get('agent.defaultModel')).toBe('openai/gpt-4o');
      expect(manager.get('agent.logLevel')).toBe('debug');
    });

    it('should replace array values as whole paths', async () => {
      await manager.set('plugins', { 'example-plugin': { enabled: false } });

      expect(manager.get('plugins')).toEqual({ 'example-plugin': { enabled: false } });
    });

    it('should reject array element paths', async () => {
      expect(() => manager.get('mcp.0.enabled')).toThrow(/数组路径/);
      await expect(manager.set('mcp.0.enabled', false)).rejects.toThrow(/数组路径/);
    });

    it('should reject invalid set values before persisting', async () => {
      await expect(manager.set('agent.memory.compressionThreshold', '0.8')).rejects.toBeInstanceOf(
        Error,
      );

      expect(manager.get('agent.memory.compressionThreshold')).toBe(0.8);
      const fileContent = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        agent: { memory: { compressionThreshold: number } };
      };
      expect(fileContent.agent.memory.compressionThreshold).toBe(0.8);
    });

    it('should reject patching scalar targets', async () => {
      await expect(manager.patch('agent.logLevel', {})).rejects.toThrow(/对象/);
    });

    it('should atomically update multiple top-level sections', async () => {
      await manager.update({
        agent: { logLevel: 'debug' },
        providers: {
          openai: {
            apiKey: 'sk-test',
            apiType: 'openai-responses',
            models: {},
          },
        },
        plugins: { exec: { enabled: false } },
      });

      expect(manager.get('agent.defaultModel')).toBe('openai/gpt-4o');
      expect(manager.get('agent.logLevel')).toBe('debug');
      expect(manager.get('providers')).toEqual({
        openai: {
          apiKey: 'sk-test',
          apiType: 'openai-responses',
          models: {},
        },
      });
      expect(manager.get('plugins')).toEqual({ exec: { enabled: false } });

      const fileContent = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        agent: { logLevel?: string };
        plugins: Record<string, unknown>;
      };
      expect(fileContent.agent.logLevel).toBe('debug');
      expect(fileContent.plugins).toEqual({ exec: { enabled: false } });
    });

    it('should reject invalid atomic updates before persisting any section', async () => {
      const originalContent = readFileSync(configPath, 'utf-8');

      await expect(
        manager.update({
          agent: { logLevel: 'debug' },
          providers: {
            openai: {
              apiType: 'not-supported',
              models: {},
            },
          },
        }),
      ).rejects.toThrow(/配置验证失败/);

      expect(manager.get('agent.logLevel')).toBe('info');
      expect(readFileSync(configPath, 'utf-8')).toBe(originalContent);
    });
  });

  describe('registerDefaults and syncDefaults', () => {
    it('should merge registered defaults into config', async () => {
      manager.registerDefaults('channels.testchannel', { enabled: true, url: 'ws://localhost' });
      await manager.syncDefaults();

      const channels = manager.get('channels') as Record<string, unknown>;
      expect(channels.testchannel).toBeDefined();
    });

    it('should preserve existing channel values during syncDefaults', async () => {
      const existingConfig = makeConfig({
        channels: {
          testchannel: {
            enabled: false,
            url: 'wss://user-configured.example',
            nested: { retries: 5 },
          },
        },
      });
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      manager.stopHotReload();
      manager = new ConfigManager(testRoot);

      manager.registerDefaults('channels.testchannel', {
        enabled: true,
        url: 'ws://localhost',
        nested: { retries: 3, timeoutMs: 1000 },
      });

      await manager.syncDefaults();

      const testChannel = (manager.get('channels') as Record<string, Record<string, unknown>>)
        .testchannel;
      expect(testChannel.enabled).toBe(false);
      expect(testChannel.url).toBe('wss://user-configured.example');
      expect(testChannel.nested).toEqual({ retries: 5, timeoutMs: 1000 });
    });

    it('should backfill missing nested channel fields during syncDefaults', async () => {
      const existingConfig = makeConfig({
        channels: {
          testchannel: {
            nested: { retries: 2 },
          },
        },
      });
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      manager.stopHotReload();
      manager = new ConfigManager(testRoot);

      manager.registerDefaults('channels.testchannel', {
        enabled: true,
        nested: { retries: 3, timeoutMs: 1000 },
      });

      await manager.syncDefaults();

      const testChannel = (manager.get('channels') as Record<string, Record<string, unknown>>)
        .testchannel;
      expect(testChannel.enabled).toBe(true);
      expect(testChannel.nested).toEqual({ retries: 2, timeoutMs: 1000 });
    });

    it('should reject invalid synced defaults before persisting', async () => {
      manager.registerDefaults('providers.test-provider', {
        apiType: 'openai-responses',
        apiKey: 123,
      } as never);

      await expect(manager.syncDefaults()).rejects.toBeInstanceOf(Error);
      expect(manager.get('providers')).toEqual({});
      const fileContent = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        providers: Record<string, unknown>;
      };
      expect(fileContent.providers).toEqual({});
    });
  });

  describe('hot reload', () => {
    it('should refresh cache on valid hot reload changes', async () => {
      manager.startHotReload();

      const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      updated.agent = {
        defaultModel: 'openai/gpt-4o-mini',
        logLevel: 'debug',
        memory: { compressionThreshold: 0.6 },
      };
      writeFileSync(configPath, JSON.stringify(updated, null, 2));

      await waitForExpect(() => expect(manager.get('agent.defaultModel')).toBe('openai/gpt-4o-mini'));
    });

    it('should keep previous cache on invalid hot reload changes', async () => {
      manager.startHotReload();

      writeFileSync(
        configPath,
        JSON.stringify({ ...makeConfig(), agent: { memory: { compressionThreshold: 'bad' } } }, null, 2),
      );

      await expectStable(() => expect(manager.get('agent.memory.compressionThreshold')).toBe(0.8));
    });
  });

  describe('resolvedPaths', () => {
    it('should expose resolved paths', () => {
      const paths = manager.resolvedPaths;
      expect(paths.runtimeRoot).toBe(join(testRoot, '.aesyclaw'));
      expect(paths.configFile).toBe(configPath);
    });
  });
});
