/**
 * ConfigManager unit tests.
 *
 * Tests cover: load, get, subscribe, update, hot-reload, defaults sync.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigManager } from '../../../../src/core/config/config-manager';

const TEST_DIR = join(tmpdir(), 'aesyclaw-test-config');

describe('ConfigManager', () => {
  let manager: ConfigManager;
  let configPath: string;

  beforeEach(() => {
    manager = new ConfigManager();
    // Create a unique temp dir for each test
    configPath = join(TEST_DIR, `config-${Date.now()}.json`);
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    manager.stopHotReload();
    // Clean up temp files
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true });
    }
  });

  afterAll(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('load', () => {
    it('should create a default config file if one does not exist', async () => {
      await manager.load(configPath);

      expect(existsSync(configPath)).toBe(true);
      const config = manager.getConfig();
      expect(config.server.port).toBe(3000);
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.server.logLevel).toBe('info');
    });

    it('should persist to the exact configPath provided by callers', async () => {
      configPath = join(TEST_DIR, 'custom-location', `provided-${Date.now()}.json`);

      await manager.load(configPath);

      expect(existsSync(configPath)).toBe(true);
      expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toMatchObject({
        server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
      });

      await manager.update({ server: { port: 4567 } });

      expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toMatchObject({
        server: { port: 4567, host: '0.0.0.0', logLevel: 'info' },
      });
    });

    it('should load an existing config file', async () => {
      const existingConfig = {
        server: { port: 8080, host: 'localhost', logLevel: 'debug' },
        providers: {},
        channels: {},
        agent: {
          memory: { compressionThreshold: 0.7 },
          multimodal: {
            speechToText: { provider: 'test', model: 'test-model' },
            imageUnderstanding: { provider: 'test', model: 'test-model' },
          },
        },
        mcp: [],
        plugins: [],
      };

      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      await manager.load(configPath);

      const config = manager.getConfig();
      expect(config.server.port).toBe(8080);
      expect(config.server.host).toBe('localhost');
    });

    it('should throw on invalid JSON', async () => {
      writeFileSync(configPath, 'not json');

      await expect(manager.load(configPath)).rejects.toThrow();
    });

    it('should reject explicitly invalid values instead of coercing them', async () => {
      const invalidConfig = {
        server: { port: '3000', host: 'localhost', logLevel: 'info' },
        providers: {},
        channels: {},
        agent: {
          memory: { compressionThreshold: 0.8 },
          multimodal: {
            speechToText: { provider: 'openai', model: 'whisper-1' },
            imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
          },
        },
        mcp: [],
        plugins: [],
      };

      writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      await expect(manager.load(configPath)).rejects.toBeInstanceOf(Error);
    });

    it('should still fill defaults for missing optional fields', async () => {
      const partialConfig = {
        server: { port: 8080, host: 'localhost', logLevel: 'debug' },
        providers: {},
        channels: {},
        agent: {
          memory: { compressionThreshold: 0.7 },
          multimodal: {
            speechToText: { provider: 'test', model: 'test-model' },
            imageUnderstanding: { provider: 'test', model: 'test-model' },
          },
        },
        mcp: [{ name: 'local', transport: 'stdio' }],
        plugins: [{ name: 'example-plugin' }],
      };

      writeFileSync(configPath, JSON.stringify(partialConfig, null, 2));

      await manager.load(configPath);

      expect(manager.get('mcp')[0]?.enabled).toBe(true);
      expect(manager.get('plugins')[0]?.enabled).toBe(true);
    });
  });

  describe('get', () => {
    it('should return config sections by key', async () => {
      await manager.load(configPath);

      const serverConfig = manager.get('server');
      expect(serverConfig.port).toBe(3000);

      const agentConfig = manager.get('agent');
      expect(agentConfig.memory).toBeDefined();
      expect(agentConfig.multimodal).toBeDefined();
    });

    it('should read current snapshots from the Conf-backed store', async () => {
      await manager.load(configPath);

      const externallyChangedConfig = structuredClone(manager.getConfig()) as Record<
        string,
        unknown
      >;
      externallyChangedConfig.server = { port: 7777, host: '127.0.0.1', logLevel: 'debug' };
      writeFileSync(configPath, JSON.stringify(externallyChangedConfig, null, 2));

      expect(manager.get('server')).toMatchObject({
        port: 7777,
        host: '127.0.0.1',
        logLevel: 'debug',
      });
    });

    it('should throw if config not loaded', () => {
      expect(() => manager.getConfig()).toThrow();
    });
  });

  describe('subscribe', () => {
    it('should notify subscribers when a config key changes', async () => {
      await manager.load(configPath);

      const changes: Array<{ newVal: unknown; oldVal: unknown }> = [];
      const unsubscribe = manager.subscribe('server', (newVal, oldVal) => {
        changes.push({ newVal, oldVal });
      });

      await manager.update({ server: { port: 8080, host: '0.0.0.0', logLevel: 'info' } });

      expect(changes.length).toBe(1);
      expect((changes[0].newVal as { port: number }).port).toBe(8080);
      expect((changes[0].oldVal as { port: number }).port).toBe(3000);

      unsubscribe();
    });

    it('should not notify when the value has not actually changed', async () => {
      await manager.load(configPath);

      let callCount = 0;
      manager.subscribe('agent', () => {
        callCount++;
      });

      // Update with the same values
      await manager.update({ server: { port: 3000, host: '0.0.0.0', logLevel: 'info' } });

      // The values are the same, so listener should not be called
      expect(callCount).toBe(0);
    });

    it('should unsubscribe when the returned function is called', async () => {
      await manager.load(configPath);

      let callCount = 0;
      const unsubscribe = manager.subscribe('server', () => {
        callCount++;
      });

      unsubscribe();
      await manager.update({ server: { port: 9090, host: '0.0.0.0', logLevel: 'info' } });

      expect(callCount).toBe(0);
    });
  });

  describe('subscribeAll', () => {
    it('should notify on any config change', async () => {
      await manager.load(configPath);

      let callCount = 0;
      manager.subscribeAll(() => {
        callCount++;
      });

      await manager.update({ server: { port: 9090, host: '0.0.0.0', logLevel: 'info' } });

      expect(callCount).toBe(1);
    });
  });

  describe('update', () => {
    it('should merge partial config and persist to disk', async () => {
      await manager.load(configPath);

      await manager.update({ agent: { memory: { compressionThreshold: 0.6 } } });

      expect(manager.get('agent').memory.compressionThreshold).toBe(0.6);

      // Read the file to verify persistence
      const fileContent = JSON.parse(
        // Re-read from disk to confirm
        await import('node:fs').then((fs) => fs.readFileSync(configPath, 'utf-8')),
      );
      expect(fileContent.agent.memory.compressionThreshold).toBe(0.6);
    });

    it('should replace requested top-level object sections instead of deep-merging removed keys', async () => {
      await manager.load(configPath);

      await manager.update({
        channels: {
          keep: { enabled: true },
          remove: { enabled: true },
        },
      });
      await manager.update(
        {
          channels: {
            keep: { enabled: false },
          },
        },
        { replaceTopLevelKeys: ['channels'] },
      );

      expect(manager.get('channels')).toEqual({ keep: { enabled: false } });
    });

    it('should preserve unrelated provider/model fields during partial provider updates', async () => {
      await manager.load(configPath);

      await manager.update({
        providers: {
          openai: {
            apiType: 'openai_responses',
            apiKey: 'sk-openai',
            baseUrl: 'https://old.example.test',
            unknownProviderField: 'provider-future',
            models: {
              fast: {
                routingHint: 'fast-lane',
                contextWindow: 128000,
                unknownModelField: 'model-future',
              },
            },
          },
          anthropic: {
            apiType: 'anthropic',
            apiKey: 'sk-anthropic',
            models: {
              sonnet: { routingHint: 'balanced' },
            },
          },
        },
      } as never);

      await manager.update({
        providers: {
          openai: {
            baseUrl: 'https://new.example.test',
            models: {
              fast: { contextWindow: 64000 },
            },
          },
        },
      } as never);

      const providers = manager.get('providers') as Record<string, Record<string, unknown>>;
      expect(providers.openai).toMatchObject({
        apiType: 'openai_responses',
        apiKey: 'sk-openai',
        baseUrl: 'https://new.example.test',
        unknownProviderField: 'provider-future',
      });
      expect(
        (providers.openai?.models as Record<string, Record<string, unknown>>).fast,
      ).toMatchObject({
        routingHint: 'fast-lane',
        contextWindow: 64000,
        unknownModelField: 'model-future',
      });
      expect(providers.anthropic).toMatchObject({
        apiType: 'anthropic',
        apiKey: 'sk-anthropic',
      });
    });

    it('should reject invalid merged config before persisting or notifying', async () => {
      await manager.load(configPath);

      let callCount = 0;
      manager.subscribeAll(() => {
        callCount++;
      });

      await expect(manager.update({ server: { port: '8080' } } as never)).rejects.toBeInstanceOf(
        Error,
      );

      expect(manager.get('server').port).toBe(3000);
      const fileContent = JSON.parse(
        await import('node:fs').then((fs) => fs.readFileSync(configPath, 'utf-8')),
      ) as { server: { port: number } };
      expect(fileContent.server.port).toBe(3000);
      expect(callCount).toBe(0);
    });
  });

  describe('registerDefaults and syncDefaults', () => {
    it('should merge registered defaults into config', async () => {
      await manager.load(configPath);

      manager.registerDefaults('channels.testchannel', { enabled: true, url: 'ws://localhost' });
      await manager.syncDefaults();

      const channels = manager.get('channels');
      expect((channels as Record<string, unknown>).testchannel).toBeDefined();
    });

    it('should preserve existing channel values during syncDefaults', async () => {
      const existingConfig = {
        server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
        providers: {},
        channels: {
          testchannel: {
            enabled: false,
            url: 'wss://user-configured.example',
            nested: { retries: 5 },
          },
        },
        agent: {
          memory: { compressionThreshold: 0.8 },
          multimodal: {
            speechToText: { provider: 'openai', model: 'whisper-1' },
            imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
          },
        },
        mcp: [],
        plugins: [],
      };

      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));
      await manager.load(configPath);

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
      const existingConfig = {
        server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
        providers: {},
        channels: {
          testchannel: {
            nested: { retries: 2 },
          },
        },
        agent: {
          memory: { compressionThreshold: 0.8 },
          multimodal: {
            speechToText: { provider: 'openai', model: 'whisper-1' },
            imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
          },
        },
        mcp: [],
        plugins: [],
      };

      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));
      await manager.load(configPath);

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

    it('should reject invalid synced defaults before persisting or notifying', async () => {
      await manager.load(configPath);

      let callCount = 0;
      manager.subscribeAll(() => {
        callCount++;
      });

      manager.registerDefaults('providers.test-provider', {
        apiType: 'openai_responses',
        apiKey: 123,
      } as never);

      await expect(manager.syncDefaults()).rejects.toBeInstanceOf(Error);
      expect(manager.get('providers')).toEqual({});
      const fileContent = JSON.parse(
        await import('node:fs').then((fs) => fs.readFileSync(configPath, 'utf-8')),
      ) as { providers: Record<string, unknown> };
      expect(fileContent.providers).toEqual({});
      expect(callCount).toBe(0);
    });
  });

  describe('hot reload', () => {
    it('should detect external file changes', async () => {
      await manager.load(configPath);
      manager.startHotReload();

      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      let receivedNewConfig = false;
      manager.subscribe('agent', () => {
        receivedNewConfig = true;
      });

      // Modify the file externally
      const newConfig = {
        server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
        providers: {},
        channels: {},
        agent: {
          memory: { compressionThreshold: 0.5 }, // Changed
          multimodal: {
            speechToText: { provider: 'openai', model: 'whisper-1' },
            imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
          },
        },
        mcp: [],
        plugins: [],
      };
      writeFileSync(configPath, JSON.stringify(newConfig, null, 2));

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedNewConfig).toBe(true);
      expect(manager.get('agent').memory.compressionThreshold).toBe(0.5);

      manager.stopHotReload();
    });
  });
});
